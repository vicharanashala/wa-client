import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { Result } from 'oxide.ts';
import { LangGraphClientService } from '../../langgraph-client.service';
import { ResponseProgressService } from '../../response-progress.service';
import { WhatsappService } from '../../../whatsapp-api/whatsapp.service';
import { PendingQuestionRepository } from '../../../pending-questions/pending-question.repository';
import { WhatsappUserRepository } from '../../../user-stats/whatsapp-user.repository';
import { FFVService } from '../../../farmer-friendly/ffv-service';

/**
 * Check if a string contains non-Latin/Roman script characters
 * This includes: Hindi, Kannada, Tamil, Telugu, Bengali, Gujarati, etc.
 */
function containsNonLatinScript(text: string): boolean {
  // Regular expression that matches non-Latin characters (Devanagari, Kannada, Tamil, etc.)
  // Unicode ranges for various Indic scripts and other non-Latin scripts
  const nonLatinRegex = /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0D80-\u0DFF\u0E00-\u0E7F\u0E80-\u0EFF\u0F00-\u0FFF\u1000-\u109F\u10A0-\u10FF\u1100-\u11FF\u1200-\u137F\u13A0-\u13FF\u1400-\u167F\u1680-\u169F\u16A0-\u16FF\u1700-\u171F\u1720-\u173F\u1740-\u175F\u1760-\u177F\u1780-\u17FF\u1800-\u18AF\u1900-\u194F\u1950-\u197F\u1980-\u19DF\u19E0-\u19FF\u1A00-\u1A1F\u1B00-\u1B7F\u1B80-\u1BBF\u1C00-\u1C4F\u1C50-\u1C7F\u1CD0-\u1CFF\u1D00-\u1D7F\u1D80-\u1DBF\u1E00-\u1EFF\u2C00-\u2C5F\u2C60-\u2C7F\u2C80-\u2CFF\u2D00-\u2D2F\u2D30-\u2D7F\u2D80-\u2DDF\u2E80-\u2EFF\u2F00-\u2FDF\u2FF0-\u2FFF\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u3100-\u312F\u3130-\u318F\u3190-\u319F\u31A0-\u31BF\u31C0-\u31EF\u31F0-\u31FF\u3200-\u32FF\u3300-\u33FF\u3400-\u4DBF\u4DC0-\u4DFF\u4E00-\u9FFF\uA000-\uA48F\uA490-\uA4CF\uA500-\uA63F\uA640-\uA69F\uA6A0-\uA6FF\uA700-\uA71F\uA720-\uA7FF\uA800-\uA82F\uA830-\uA83F\uA840-\uA87F\uA880-\uA8DF\uA8E0-\uA8FF\uA900-\uA92F\uA930-\uA95F\uA960-\uA97F\uA980-\uA9DF\uAA00-\uAA5F\uAA60-\uAA7F\uAA80-\uAADF\uAAE0-\uAAFF\uAB00-\uAB2F\uAB30-\uAB6F\uABC0-\uABFF\uAC00-\uD7AF\uD800-\uDB7F\uDB80-\uDBFF\uDC00-\uDFFF\uFB00-\uFB4F\uFB50-\uFDFF\uFE70-\uFEFF\uFF00-\uFFEF]/;
  
  return nonLatinRegex.test(text);
}

/**
 * Get localized "Show More" button text based on the user's input script
 */
function getShowMoreButtonTitle(userText: string): string {
  if (containsNonLatinScript(userText)) {
    // Return Kannada text (you can add more language options based on detected script)
    return '🔎 ಸಂಪೂರ್ಣ ಮಾಹಿತಿ ಪಡೆಯಿರಿ';
  }
  return '🔎 Get Full Info';
}

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

    this.logger.debug(
      `[${phoneNumber}] User text: "${content.slice(0, 60)}"`,
    );

    // ── FFV Check FIRST: Skip progress messages for FFV responses ──
    if (this.ffvService.isEnabled()) {
      const normalizedContent = content.toLowerCase().trim();
      
      // Handle "more" keyword OR button title text to show full answer
      if (
        normalizedContent === 'more' || 
        normalizedContent === 'show more' || 
        normalizedContent === 'full answer' || 
        normalizedContent === 'more details' || 
        normalizedContent === 'पूरा उत्तर' || 
        normalizedContent === 'ज्यादा जानकारी' ||
        normalizedContent.includes('get full info') ||
        content.includes('🔎 Get Full Info')
      ) {
        this.logger.log(`[${phoneNumber}] FFV show more request`);
        
        // Show typing indicator
        await this.whatsappService.showTyping(messageId);
        
        // Small delay for realistic feel
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const lastQuestionId = this.ffvService.getLastQuestionId(phoneNumber);
        if (lastQuestionId) {
          const fullAnswer = this.ffvService.getByQuestionId(lastQuestionId);
          if (fullAnswer.found && fullAnswer.bigAnswer) {
            await this.whatsappService.markAsRead(messageId);
            await this.whatsappService.sendTextMessage(
              phoneNumber,
              `📖 *Full Detailed Answer:*\n\n${fullAnswer.bigAnswer}`,
              messageId,
            );
            await this.whatsappUserRepo.recordMessage(phoneNumber, content);
            return;
          }
        }
        // Fallback to first question if no last question found
        const firstQuestion = this.ffvService.getByQuestionId('ffv_q_1');
        if (firstQuestion.found && firstQuestion.bigAnswer) {
          await this.whatsappService.markAsRead(messageId);
          await this.whatsappService.sendTextMessage(
            phoneNumber,
            `📖 *Full Detailed Answer:*\n\n${firstQuestion.bigAnswer}`,
            messageId,
          );
          await this.whatsappUserRepo.recordMessage(phoneNumber, content);
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

        // Show typing indicator
        await this.whatsappService.showTyping(messageId);
        
        // Small delay for realistic feel
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Mark as read
        await this.whatsappService.markAsRead(messageId);

        // Send short answer with WhatsApp Interactive Button
        // Use localized button text based on user's input script
        const buttonTitle = getShowMoreButtonTitle(content);
        await this.whatsappService.sendInteractiveButtonMessage(
          phoneNumber,
          ffvResult.shortAnswer,
          [{ id: `ffv_show_more_${ffvResult.questionId}`, title: buttonTitle }],
          messageId,
        );

        await this.whatsappUserRepo.recordMessage(phoneNumber, content);
        return;
      }
    }

    // ── No FFV match - Send friendly message with available questions ──
    const allQuestions = this.ffvService.getAllQuestions().join('\n');
    await this.whatsappService.sendTextMessage(
      phoneNumber,
      `🌾 *This is a DEMO version.*\n\n*Available Questions:*\n${allQuestions}\n\nPlease copy-paste any question above!`,
      messageId,
    );
    await this.whatsappUserRepo.recordMessage(phoneNumber, content);
    return;
  }
}