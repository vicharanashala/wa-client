import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { ProcessWhatsappMessageCommand } from './process-whatsapp-message.command';
import { LlmService } from '../services/llm.service';
import { WhatsappOutboundService } from '../services/whatsapp-outbound.service';

@CommandHandler(ProcessWhatsappMessageCommand)
export class ProcessWhatsappMessageHandler
  implements ICommandHandler<ProcessWhatsappMessageCommand>
{
  private readonly logger = new Logger(ProcessWhatsappMessageHandler.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly whatsappOutbound: WhatsappOutboundService,
  ) {}

  async execute(command: ProcessWhatsappMessageCommand): Promise<void> {
    const { phoneNumber, messageText } = command;

    this.logger.log(
      `Processing message from ${phoneNumber}: "${messageText.slice(0, 80)}${messageText.length > 80 ? '…' : ''}"`,
    );

    // 1. Generate LLM response (returns Result<string, Error>)
    const result = await this.llmService.generateResponse(
      phoneNumber,
      messageText,
    );

    // 2. Unwrap the Result — on Err, send a fallback message to the user
    if (result.isErr()) {
      this.logger.error(
        `LLM failed for ${phoneNumber}: ${result.unwrapErr().message}`,
      );
      await this.whatsappOutbound.sendText(
        phoneNumber,
        'Sorry, I encountered an issue processing your message. Please try again.',
      );
      return;
    }

    const reply = result.unwrap();

    // 3. Send the reply back to WhatsApp
    const sendResult = await this.whatsappOutbound.sendText(
      phoneNumber,
      reply,
    );

    if (!sendResult.success) {
      this.logger.error(
        `Failed to send reply to ${phoneNumber}: ${sendResult.error}`,
      );
    } else {
      this.logger.log(`Reply sent to ${phoneNumber}`);
    }
  }
}