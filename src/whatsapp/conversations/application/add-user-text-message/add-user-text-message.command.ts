import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { LangGraphClientService } from '../../langgraph-client.service';
import { WhatsappService } from '../../../whatsapp-api/whatsapp.service';
import { Result } from 'oxide.ts';

export class AddUserTextMessageCommand {
  constructor(
    public readonly phoneNumber: string,
    public readonly content: string,
    public readonly messageId: string,
  ) {}
}

@CommandHandler(AddUserTextMessageCommand)
export class AddUserTextMessageHandler
  implements ICommandHandler<AddUserTextMessageCommand>
{
  private readonly logger = new Logger(AddUserTextMessageHandler.name);

  constructor(
    private readonly langGraph: LangGraphClientService,
    private readonly whatsappService: WhatsappService,
  ) {}

  async execute(command: AddUserTextMessageCommand): Promise<void> {
    const { phoneNumber, content, messageId } = command;

    this.logger.debug(`[${phoneNumber}] User text: "${content.slice(0, 60)}"`);

    // Show typing indicator (non-fatal)
    const typingResult = await Result.safe(
      this.whatsappService.showTyping(messageId),
    );

    if (typingResult.isErr()) {
      this.logger.warn(`[${phoneNumber}] showTyping failed: ${typingResult.unwrapErr().message}`);
    }

    // Gate: require location before proceeding
    const hasLocation = await this.langGraph.hasLocation(phoneNumber);
    if (!hasLocation) {
      this.logger.log(`[${phoneNumber}] No location in thread state — requesting location`);
      await this.whatsappService.sendLocationRequest(phoneNumber);
      return;
    }

    // Send message to LangGraph; thread is created/reused automatically
    const { reply } = await this.langGraph.sendMessage(phoneNumber, content);

    // Send the AI reply back to the user
    await this.whatsappService.sendTextMessage(phoneNumber, reply, messageId);
    this.logger.log(`[${phoneNumber}] Sent: "${reply.slice(0, 60)}"`);
  }
}
