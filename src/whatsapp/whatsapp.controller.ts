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
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { AddUserTextMessageCommand } from './conversations/application/add-user-text-message/add-user-text-message.command';
import { SetUserLocationCommand } from './conversations/application/set-user-location/set-user-location.command';
import {
  AddUserVoiceMessageCommand
} from './conversations/application/add-user-voice-message/add-user-voice-message.command';

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

  constructor(private readonly commandBus: CommandBus) {}

  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') _token: string,
  ): string {
    if (mode === 'subscribe') {
      this.logger.log('Webhook verified');
      return challenge;
    }
    throw new ForbiddenException('Invalid verify token');
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  receive(@Body() body: WebhookPayload): void {

    this.logger.log('Webhook received');

    const change = body?.entry?.[0]?.changes?.[0];

    if (!change || change.field !== 'messages') return;

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
            .execute(new AddUserVoiceMessageCommand(audioMsg.from, audioMsg.audio.id, audioMsg.id))
            .catch((err: Error) => {
              this.logger.error(`Voice message command failed: ${err.message}`);
          })
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
        .execute(new AddUserTextMessageCommand(phoneNumber, messageText, message.id))
        .catch((err: Error) =>
          this.logger.error(
            `Command failed for ${phoneNumber}: ${err.message}`,
            err.stack,
          ),
        );
    }
  }
}
