import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  Logger,
  RawBody,
  Headers
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { AddUserTextMessageCommand } from './conversations/application/add-user-text-message/add-user-text-message.command';
import { SetUserLocationCommand } from './conversations/application/set-user-location/set-user-location.command';
import {
  AddUserVoiceMessageCommand
} from './conversations/application/add-user-voice-message/add-user-voice-message.command';
import { CallingService } from './calling/calling.service';
import { ReviewerPollingService } from './pending-questions/reviewer-polling.service';
import * as crypto from 'crypto';

// ── Webhook Types ────────────────────────────────────────────────────────────

interface Metadata {
  display_phone_number: string;
  phone_number_id: string;
}

interface ContactProfile {
  profile: { name: string };
  wa_id?: string;
}

interface TextMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text';
  text: { body: string };
}

interface NonTextMessage {
  from: string;
  id: string;
  timestamp: string;
  type:
    | 'audio'
    | 'document'
    | 'image'
    | 'video'
    | 'sticker'
    | 'location'
    | 'contacts'
    | 'reaction'
    | 'interactive'
    | 'order'
    | 'system'
    | 'unsupported';
}

type IncomingMessage = TextMessage | NonTextMessage;

interface IncomingMessageValueGeneral {
  messaging_product: 'whatsapp';
  metadata: Metadata;
  contacts: ContactProfile[];
  messages: IncomingMessage[];
  statuses?: never;
  groups?: never;
}

interface AudioMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'audio';
  audio: {
    id: string;
    mime_type: string;
    sha256: string;
    voice: boolean;
  };
}

interface StatusMessageValue {
  messaging_product: 'whatsapp';
  metadata: Metadata;
  statuses: {
    id: string;
    status: 'sent' | 'delivered' | 'read' | 'failed';
    timestamp: string;
    recipient_id: string;
  }[];
  messages?: never;
  groups?: never;
}

interface GroupValue {
  messaging_product: 'whatsapp';
  metadata: Metadata;
  groups: { group_id: string; type: string; timestamp: number }[];
  messages?: never;
  statuses?: never;
}

type ChangeValue =
  | IncomingMessageValueGeneral
  | StatusMessageValue
  | GroupValue;

interface Change {
  field:
    | 'messages'
    | 'group_lifecycle_update'
    | 'group_settings_update'
    | 'group_participant_update';
  value: ChangeValue;
}

interface Entry {
  id: string;
  changes: Change[];
}

interface WebhookPayload {
  object: 'whatsapp_business_account';
  entry: Entry[];
}

interface LocationMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'location';
  location: {
    latitude: number;
    longitude: number;
    address?: string;
    name?: string;
  };
}


// ── Controller ───────────────────────────────────────────────────────────────

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly commandBus: CommandBus,
    private readonly callingService: CallingService,
    private readonly reviewerPollingService: ReviewerPollingService,
  ) {}

  @Get('test-poll')
  async triggerPollManually(): Promise<string> {
    this.logger.log('🔥 Manual poll triggered via HTTP endpoint');
    await this.reviewerPollingService.pollReviewerSystem();
    return 'Polling triggered successfully! Check your server logs.';
  }

  @Post('reviewer-webhook')
  @HttpCode(HttpStatus.OK)
  async handleReviewerWebhook(
    @Headers('x-internal-api-key') apiKey: string,
    @Body() body: any,
  ): Promise<string> {
    const expectedKey = process.env.REVIEWER_INTERNAL_API_KEY;
    if (!expectedKey || apiKey !== expectedKey) {
      this.logger.warn('Unauthorized access attempt to reviewer webhook');
      throw new ForbiddenException('Invalid API Key');
    }

    this.logger.log(`📥 Received webhook from reviewer system for question: ${body.question_id}`);
    
    // Process the webhook in the background so we don't block the response
    this.reviewerPollingService.processWebhookAnswer(body).catch((err) => {
      this.logger.error(`Failed to process webhook for question ${body.question_id}: ${err.message}`);
    });

    return 'OK';
  }

  @Get('webhook')
  verify(
    @Query() query: Record<string, string>,
  ): string {
    const mode = query['hub.mode'];
    const challenge = query['hub.challenge'];
    const token = query['hub.verify_token'];
    const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

    this.logger.debug(`Webhook verify: mode=${mode}, token=${token}, expected=${verifyToken}`);
    this.logger.debug(`Full query: ${JSON.stringify(query)}`);

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('Webhook verified');
      return challenge;
    }
    throw new ForbiddenException('Invalid verify token');
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  receive(
    @Headers('x-hub-signature-256') signature: string,
    @RawBody() rawBody: Buffer, // ← add this
    @Body() body: any,
  ): void {
    this.logger.log('Webhook received');
    // ── Signature Verification ──
    const appSecret = process.env.WHATSAPP_META_APP_SECRET || '';
    const expected =
      'sha256=' +
      crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

    if (!signature || signature !== expected) {
      this.logger.warn('Rejected webhook: invalid signature');
      throw new ForbiddenException('Invalid signature');
    }

    const change = body?.entry?.[0]?.changes?.[0];
    if (!change) return;

    // ── Handle Call Webhooks ──
    if (change.field === 'calls') {
      this.handleCallWebhook(change.value);
      return;
    }

    if (change.field !== 'messages') return;

    const value = change.value;

    if (value.statuses || value.groups) return;

    const messages = value.messages;
    if (!Array.isArray(messages)) return;

    for (const message of messages) {
      if (message.type === 'location') {
        const loc = (message as LocationMessage).location;
        this.commandBus
          .execute(
            new SetUserLocationCommand(
              message.from,
              message.id,
              loc.latitude,
              loc.longitude,
              loc.address,
            ),
          )
          .catch((err: Error) =>
            this.logger.error(`Location command failed: ${err.message}`),
          );
        continue;
      }

      if (message.type === 'audio') {
        const audioMsg = message as unknown as AudioMessage;
        if (audioMsg.audio.voice) {
          this.commandBus
            .execute(
              new AddUserVoiceMessageCommand(
                audioMsg.from,
                audioMsg.audio.id,
                audioMsg.id,
              ),
            )
            .catch((err: Error) => {
              this.logger.error(`Voice message command failed: ${err.message}`);
            });
        }
        continue;
      }

      if (message.type !== 'text') {
        this.logger.debug(
          `Skipping non-text message [type=${message.type}] from ${message.from}`,
        );
        continue;
      }

      const phoneNumber = message.from;
      const messageText = message.text.body.trim();

      if (!phoneNumber || !messageText) continue;

      this.logger.log(
        `Incoming [${phoneNumber}]: "${messageText.slice(0, 60)}${messageText.length > 60 ? '…' : ''}"`,
      );

      this.commandBus
        .execute(
          new AddUserTextMessageCommand(phoneNumber, messageText, message.id),
        )
        .catch((err: Error) =>
          this.logger.error(
            `Command failed for ${phoneNumber}: ${err.message}`,
            err.stack,
          ),
        );
    }
  }

  // ── Call Webhook Handler ──────────────────────────────────────────────────

  private handleCallWebhook(value: any): void {
    if (!value) return;
  
    // DEBUG: Log raw call webhook payload to understand structure
    this.logger.debug(`📞 RAW CALL WEBHOOK: ${JSON.stringify(value, null, 2)}`);
  
    // value.calls is an array of call events
    const calls = value.calls;
    if (!Array.isArray(calls)) {
      this.logger.warn(
        `No calls array in webhook value. Keys: ${Object.keys(value).join(', ')}`,
      );
      return;
    }
  
    for (const call of calls) {
      this.logger.debug(`📞 RAW CALL OBJECT: ${JSON.stringify(call, null, 2)}`);
      const callId = call.call_id || call.id;
      const event = call.event || call.type;
      const from = call.from;
  
      this.logger.log(
        `📞 Call event: ${event} | call_id: ${callId} | from: ${from}`,
      );
  
      if (event === 'connect') {
        // Incoming call with SDP offer
        const sdpOffer = call.session?.sdp;
        if (!sdpOffer) {
          this.logger.error(`No SDP offer in connect event for ${callId}`);
          return;
        }
  
        this.callingService
          .handleIncomingCall(callId, from, sdpOffer)
          .catch((err: Error) =>
            this.logger.error(
              `Call handling failed: ${err.message}`,
              err.stack,
            ),
          );
      } else if (event === 'terminate') {
        this.callingService
          .handleCallEnd(callId)
          .catch((err: Error) =>
            this.logger.error(`Call cleanup failed: ${err.message}`),
          );
      } else {
        this.logger.debug(`Unhandled call event: ${event}`);
      }
    }
  }
}
