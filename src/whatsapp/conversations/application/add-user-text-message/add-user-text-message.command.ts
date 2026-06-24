import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { LangGraphClientService } from '../../langgraph-client.service';
import { WhatsappService } from '../../../whatsapp-api/whatsapp.service';
import { PendingQuestionRepository } from '../../../pending-questions/pending-question.repository';
import { WhatsappUserRepository } from '../../../user-stats/whatsapp-user.repository';
import { LanguageSupportService } from '../../../language-support/language-support.service';
import { Result } from 'oxide.ts';

export class AddUserTextMessageCommand {
  constructor(
    public readonly phoneNumber: string,
    public readonly content: string,
    public readonly messageId: string,
  ) {}
}

@CommandHandler(AddUserTextMessageCommand)
export class AddUserTextMessageHandler implements ICommandHandler<AddUserTextMessageCommand> {
  private readonly logger = new Logger(AddUserTextMessageHandler.name);

  constructor(
    private readonly langGraph: LangGraphClientService,
    private readonly whatsappService: WhatsappService,
    private readonly pendingQuestionRepo: PendingQuestionRepository,
    private readonly whatsappUserRepo: WhatsappUserRepository,
    private readonly languageSupport: LanguageSupportService,
  ) {}

  async execute(command: AddUserTextMessageCommand): Promise<void> {
    const { phoneNumber, content, messageId } = command;

    this.logger.debug(`[${phoneNumber}] User text: "${content.slice(0, 60)}"`);

    // Ensure daily thread handover is completed (IST day boundary).
    await this.langGraph.prepareDailyThread(phoneNumber);

    // Show typing indicator (non-fatal)
    const typingResult = await Result.safe(
      this.whatsappService.showTyping(messageId),
    );

    if (typingResult.isErr()) {
      this.logger.warn(
        `[${phoneNumber}] showTyping failed: ${typingResult.unwrapErr().message}`,
      );
    }

    // Send message to LangGraph; thread is created/reused automatically
    const { reply, reviewId } = await this.langGraph.sendMessage(
      phoneNumber,
      content,
    );

    await this.whatsappUserRepo.recordMessage(phoneNumber, content);

    // If LangGraph flagged this for human review, save to pending_questions
    if (reviewId) {
      const langGraphThreadId = await this.langGraph.ensureThread(phoneNumber);
      const languagePair =
        await this.languageSupport.resolveLanguagePair(content);
      await this.pendingQuestionRepo.create({
        questionId: reviewId,
        phoneNumber,
        queryText: content,
        toolCallId: `force-${Date.now()}`,
        originalMessageId: messageId,
        langGraphThreadId,
        scriptLanguage: languagePair.scriptLanguage,
        vocalLanguage: languagePair.vocalLanguage,
      });
      this.logger.log(
        `[${phoneNumber}] 📝 Pending question created — REV_ID: ${reviewId}`,
      );
    }

    // Send the AI reply back to the user (clean, without REV_ID line)
    await this.whatsappService.sendTextMessage(phoneNumber, reply, messageId);
    this.logger.log(`[${phoneNumber}] Sent: "${reply.slice(0, 60)}"`);
  }
}
