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
import { ProcessWhatsappMessageCommand } from './commands/process-whatsapp-message.command';

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(private readonly commandBus: CommandBus) {}

  // ──────────────────────────────────────────────────────────────────
  // GET /whatsapp/webhook — Meta verification challenge
  // ──────────────────────────────────────────────────────────────────
  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') token: string,
  ): string {
    if (mode === 'subscribe') {
      this.logger.log('Webhook verified successfully');
      return challenge;
    }

    this.logger.warn('Webhook verification failed');
    throw new ForbiddenException('Invalid verify token');
  }

  // ──────────────────────────────────────────────────────────────────
  // POST /whatsapp/webhook — Incoming messages from Meta
  // ──────────────────────────────────────────────────────────────────
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receive(@Body() body: any): Promise<string> {
    // Always return 200 OK immediately to prevent Meta retries.
    // Actual processing happens asynchronously via the command bus.
    try {
      const entry = body?.entry?.[0];
      const change = entry?.changes?.[0];

      if (!change || change.field !== 'messages') {
        return 'OK';
      }

      const value = change.value;

      // Ignore status updates (delivered, read, etc.)
      if (value?.statuses) {
        return 'OK';
      }

      const messages: any[] = value?.messages;
      if (!messages || !Array.isArray(messages)) {
        return 'OK';
      }

      for (const message of messages) {
        // Only handle text messages
        if (message.type !== 'text') {
          this.logger.debug(`Ignoring non-text message type: ${message.type}`);
          continue;
        }

        const phoneNumber: string = message.from;
        const messageText: string = message.text?.body?.trim() || '';

        if (!phoneNumber || !messageText) {
          continue;
        }

        this.logger.log(
          `Incoming from ${phoneNumber}: "${messageText.slice(0, 50)}${messageText.length > 50 ? '…' : ''}"`,
        );

        // Fire-and-forget: dispatch the CQRS command
        this.commandBus
          .execute(
            new ProcessWhatsappMessageCommand(phoneNumber, messageText),
          )
          .catch((err) =>
            this.logger.error(
              `Command failed for ${phoneNumber}: ${err.message}`,
            ),
          );
      }
    } catch (error) {
      this.logger.error(`Webhook error: ${error.message}`, error.stack);
    }

    return 'OK';
  }
}