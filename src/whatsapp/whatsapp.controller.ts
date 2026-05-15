import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
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
import { WhatsappService } from './whatsapp-api/whatsapp.service';
import { AccessControlService } from './access-control/access-control.service';
import { LangGraphClientService } from './conversations/langgraph-client.service';
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

interface ReactionMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'reaction';
  reaction: {
    message_id: string;
    emoji: string;
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
    private readonly whatsappService: WhatsappService,
    private readonly accessControlService: AccessControlService,
    private readonly langGraphClientService: LangGraphClientService,
  ) {}

  @Get('test-poll')
  async triggerPollManually(): Promise<string> {
    this.logger.log('🔥 Manual poll triggered via HTTP endpoint');
    await this.reviewerPollingService.pollReviewerSystem();
    return 'Polling triggered successfully! Check your server logs.';
  }

  @Post('send-message')
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @Headers('x-internal-api-key') apiKey: string,
    @Body() body: { phoneNumber: string; messageText: string },
  ): Promise<{
    status: string;
    message: string;
    langGraphAppended: boolean;
    langGraphThreadId: string;
  }> {
    const expectedKey = process.env.REVIEWER_INTERNAL_API_KEY;
    if (!expectedKey || apiKey !== expectedKey) {
      this.logger.warn('Unauthorized access attempt to send-message endpoint');
      throw new ForbiddenException('Invalid API Key');
    }

    if (!body.phoneNumber || !body.messageText) {
      throw new BadRequestException('phoneNumber and messageText are required');
    }

    const langGraphThreadId =
      await this.langGraphClientService.ensureThread(body.phoneNumber);

    this.logger.log(
      `📤 Sending text message via API to ${body.phoneNumber} (thread ${langGraphThreadId})`,
    );

    try {
      await this.whatsappService.sendTextMessage(
        body.phoneNumber,
        body.messageText,
      );

      const langGraphAppended =
        await this.langGraphClientService.appendAiMessage(
          body.phoneNumber,
          body.messageText,
          { threadId: langGraphThreadId },
        );

      if (!langGraphAppended) {
        this.logger.warn(
          `WhatsApp delivered to ${body.phoneNumber} but LangGraph append failed for thread ${langGraphThreadId}`,
        );
      }

      return {
        status: 'success',
        message: 'Message sent successfully',
        langGraphAppended,
        langGraphThreadId,
      };
    } catch (err: any) {
      this.logger.error(`Failed to send message: ${err.message}`);
      throw new InternalServerErrorException('Failed to send message');
    }
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
  async receive(
    @Headers('x-hub-signature-256') signature: string,
    @RawBody() rawBody: Buffer,
    @Body() body: any,
  ): Promise<void> {
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
      // ── Access Control Gate ──
      const isAllowed = await this.accessControlService.isNumberAllowed(message.from);
      if (!isAllowed) {
        this.logger.debug(
          `🚫 Access denied for ${message.from} — sending rejection message`,
        );
        // Send a polite rejection only for text/audio messages (not statuses etc.)
        if (message.type === 'text' || message.type === 'audio') {
          this.whatsappService
            .sendTextMessage(
              message.from,
              'Thank you for reaching out to ANNAM.AI. Your number is not currently whitelisted. For access, please contact Annam.ai Foundation at communications@annam.ai',
            )
            .catch((err: Error) =>
              this.logger.error(`Failed to send rejection message to ${message.from}: ${err.message}`),
            );
        }
        continue;
      }

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
          // Send acknowledgment for voice notes
          this.whatsappService
            .sendTextMessage(
              audioMsg.from,
              '🌱 *Thank you for your voice note!* Your answer is being generated by our agricultural AI. Kindly wait a few seconds...',
            )
            .catch((err: Error) =>
              this.logger.error(`Failed to send ack message to ${audioMsg.from}: ${err.message}`),
            );

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

      if (message.type === 'reaction') {
        const reaction = message as ReactionMessage;
        const emoji = reaction.reaction?.emoji?.trim();
        const reactedMessageId = reaction.reaction?.message_id;

        if ((emoji !== '👍' && emoji !== '👎') || !reactedMessageId) {
          this.logger.debug(
            `Ignoring reaction [emoji=${emoji ?? 'unknown'}] from ${reaction.from}`,
          );
          continue;
        }

        this.logger.log(
          `Captured reaction ${emoji} from ${reaction.from} on message ${reactedMessageId}`,
        );

        this.langGraphClientService
          .appendUserReaction(reaction.from, reactedMessageId, emoji)
          .catch((err: Error) =>
            this.logger.error(`Failed to append reaction for ${reaction.from}: ${err.message}`),
          );
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

      // Send acknowledgment for text messages
      this.whatsappService
        .sendTextMessage(
          phoneNumber,
          '🌱 *Thank you for your question!* Your answer is being generated by our agricultural AI. Kindly wait a few seconds...',
        )
        .catch((err: Error) =>
          this.logger.error(`Failed to send ack message to ${phoneNumber}: ${err.message}`),
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
