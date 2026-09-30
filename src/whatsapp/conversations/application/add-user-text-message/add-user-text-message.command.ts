import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { Result } from 'oxide.ts';
import { LangGraphClientService } from '../../langgraph-client.service';
import { ResponseProgressService } from '../../response-progress.service';
import { WhatsappService } from '../../../whatsapp-api/whatsapp.service';
import { PendingQuestionRepository } from '../../../pending-questions/pending-question.repository';
import { WhatsappUserRepository } from '../../../user-stats/whatsapp-user.repository';
import { FFVService } from '../../../farmer-friendly/ffv-service';

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
    private readonly responseProgressService: ResponseProgressService,
    private readonly ffvService: FFVService,
  ) {}

  async execute(command: AddUserTextMessageCommand): Promise<void> {
    const { phoneNumber, content, messageId } = command;
    const progress = await this.responseProgressService.start({
      phoneNumber,
      messageId,
      sourceText: content,
    });

    try {
      this.logger.debug(
        `[${phoneNumber}] User text: "${content.slice(0, 60)}"`,
      );

      // ── FFV Check: Check if this question matches a predefined FFV Q&A ──
      if (this.ffvService.isEnabled()) {
        const normalizedContent = content.toLowerCase().trim();
        
        // Handle "more" keyword to show full answer
        if (normalizedContent === 'more' || normalizedContent === 'show more' || normalizedContent === 'full answer' || normalizedContent === 'more details' || normalizedContent === 'पूरा उत्तर' || normalizedContent === 'ज्यादा जानकारी') {
          this.logger.log(`[${phoneNumber}] FFV show more request`);
          
          const lastQuestionId = this.ffvService.getLastQuestionId(phoneNumber);
          if (lastQuestionId) {
            const fullAnswer = this.ffvService.getByQuestionId(lastQuestionId);
            if (fullAnswer.found && fullAnswer.bigAnswer) {
              await this.whatsappService.sendTextMessage(
                phoneNumber,
                `📖 *Full Detailed Answer:*\n\n${fullAnswer.bigAnswer}`,
                messageId,
              );
              await this.whatsappUserRepo.recordMessage(phoneNumber, content);
              await progress.stop();
              return;
            }
          }
          // Fallback to first question if no last question found
          const firstQuestion = this.ffvService.getByQuestionId('ffv_q_1');
          if (firstQuestion.found && firstQuestion.bigAnswer) {
            await this.whatsappService.sendTextMessage(
              phoneNumber,
              `📖 *Full Detailed Answer:*\n\n${firstQuestion.bigAnswer}`,
              messageId,
            );
            await this.whatsappUserRepo.recordMessage(phoneNumber, content);
            await progress.stop();
            return;
          }
        }

        const ffvResult = this.ffvService.findMatchingQA(content);
        
        if (ffvResult.found && ffvResult.shortAnswer && ffvResult.questionId) {
          this.logger.log(
            `[${phoneNumber}] FFV match found for: "${content.slice(0, 60)}"`,
          );

          // Store question ID for "more" flow
          this.ffvService.setLastQuestionId(phoneNumber, ffvResult.questionId);

          // Send short answer as text with Show More instruction
          await this.whatsappService.sendTextMessage(
            phoneNumber,
            `${ffvResult.shortAnswer}\n\n🔽 Reply "more" for full detailed answer.`,
            messageId,
          );

          await this.whatsappUserRepo.recordMessage(phoneNumber, content);
          await progress.stop();
          return;
        }
      }

      // ── No FFV match - Send friendly message ──
      await this.whatsappService.sendTextMessage(
        phoneNumber,
        '🙏 Sorry, I don\'t have information on this topic yet. Please ask me about pea crop diseases, pests, or management practices.',
        messageId,
      );
      await this.whatsappUserRepo.recordMessage(phoneNumber, content);
      await progress.stop();
      return;
    } finally {
      await progress.stop();
    }
  }
}
