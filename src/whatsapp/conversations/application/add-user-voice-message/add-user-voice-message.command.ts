import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { LangGraphClientService } from '../../langgraph-client.service';
import { SarvamService, AudioTooLongError } from '../../../sarvam-api/sarvam.service';
import { WhatsappService } from '../../../whatsapp-api/whatsapp.service';
import { PendingQuestionRepository } from '../../../pending-questions/pending-question.repository';
import { WhatsappUserRepository } from '../../../user-stats/whatsapp-user.repository';

/** Sarvam TTS chunk size — each chunk becomes one valid WhatsApp voice note. */
const TTS_CHARS_PER_VOICE_NOTE = 2500;
/** Cap voice notes so very long answers still deliver quickly; full text always sent. */
const MAX_VOICE_NOTES = 4;

export class AddUserVoiceMessageCommand {
  constructor(
    public readonly phoneNumber: string,
    public readonly mediaId: string, // WhatsApp media ID to download
    public readonly messageId: string,
  ) {}
}

@CommandHandler(AddUserVoiceMessageCommand)
export class AddUserVoiceMessageHandler
  implements ICommandHandler<AddUserVoiceMessageCommand>
{
  private readonly logger = new Logger(AddUserVoiceMessageHandler.name);

  constructor(
    private readonly langGraph: LangGraphClientService,
    private readonly sarvamService: SarvamService,
    private readonly whatsappService: WhatsappService,
    private readonly pendingQuestionRepo: PendingQuestionRepository,
    private readonly whatsappUserRepo: WhatsappUserRepository,
  ) {}

  async execute(command: AddUserVoiceMessageCommand): Promise<void> {
    const { phoneNumber, mediaId, messageId } = command;

    await this.langGraph.prepareDailyThread(phoneNumber);

    await this.whatsappService.showTyping(messageId);



    const { buffer, mimeType } =
      await this.whatsappService.downloadMedia(mediaId);

    let transcript: string;
    let languageCode: string | null = null;

    try {
      const result = await this.sarvamService.transcribeToEnglish(buffer, mimeType);
      transcript = result.transcript;
      languageCode = result.languageCode;
    } catch (err: any) {
      if (err instanceof AudioTooLongError) {
        this.logger.warn(
          `[${phoneNumber}] Audio too long (${err.estimatedSeconds.toFixed(0)}s > ${err.maxSeconds}s limit)`,
        );
        await this.whatsappService.sendTextMessage(
          phoneNumber,
          'Your audio is very long. Please type your message or send a shorter audio.',
          messageId,
        );
      } else {
        this.logger.error(
          `[${phoneNumber}] Sarvam STT failed (audio ${(buffer.length / 1024).toFixed(0)} KB): ${err?.message ?? err}`,
        );
        await this.whatsappService.sendTextMessage(
          phoneNumber,
          'Currently we are not taking audio questions, please type your questions. The audio services will resume soon.',
          messageId,
        );
      }
      return;
    }

    this.logger.debug(
      `[${phoneNumber}] Voice transcribed (${(buffer.length / 1024).toFixed(0)} KB): "${transcript.slice(0, 60)}" (lang=${languageCode})`,
    );

    const { reply, reviewId } = await this.langGraph.sendMessage(phoneNumber, transcript);

    await this.whatsappUserRepo.recordMessage(phoneNumber, transcript);

    if (reviewId) {
      const langGraphThreadId = await this.langGraph.ensureThread(phoneNumber);
      await this.pendingQuestionRepo.create({
        questionId: reviewId,
        phoneNumber,
        queryText: transcript,
        toolCallId: `force-${Date.now()}`,
        originalMessageId: messageId,
        langGraphThreadId,
        ...(languageCode ? { questionLanguageCode: languageCode } : {}),
      });
      this.logger.log(
        `[${phoneNumber}] 📝 Pending question created — REV_ID: ${reviewId}`,
      );
    }

    const voiceText = this.textForVoiceNotes(reply);
    await this.sendVoiceNotes(phoneNumber, messageId, voiceText, languageCode);

    await this.whatsappService.sendTextMessage(phoneNumber, reply, messageId);

    this.logger.log(
      `[${phoneNumber}] Sent voice (${voiceText.length} chars for TTS) + full text (${reply.length} chars, lang=${languageCode ?? 'default'})`,
    );
  }

  /** Truncate only for TTS; full `reply` is still sent as text. */
  private textForVoiceNotes(reply: string): string {
    // Strip footer/metadata before TTS - only send the actual answer content
    const cleanReply = this.stripFooterForTts(reply);
    
    const maxChars = TTS_CHARS_PER_VOICE_NOTE * MAX_VOICE_NOTES;
    if (cleanReply.length <= maxChars) return cleanReply;
    this.logger.warn(
      `Reply length ${cleanReply.length} exceeds voice cap ${maxChars} — TTS will cover first ${maxChars} chars only; full answer sent as text.`,
    );
    return cleanReply.slice(0, maxChars);
  }

  /**
   * Strip the footer/metadata section that appears after the separator line.
   * This removes things like "Answered by:", "Sources:" etc. so they don't get spoken.
   * 
   * However, it CAPTURES the "Important Notice" section (between ⚠️ and second separator)
   * and appends it at the end of the TTS text.
   */
  private stripFooterForTts(text: string): string {
    const separator = '___________________________';
    
    // Find first separator
    const firstSeparatorIndex = text.indexOf(separator);
    if (firstSeparatorIndex === -1) {
      return text;
    }
    
    // Keep content before first separator
    let mainContent = text.slice(0, firstSeparatorIndex).trim();
    
    // Find ⚠️ emoji and capture content from ⚠️ to second separator
    const warningEmoji = '⚠️';
    const warningIndex = text.indexOf(warningEmoji);
    
    if (warningIndex !== -1) {
      // Find the second separator after the warning emoji
      const secondSeparatorIndex = text.indexOf(separator, warningIndex);
      
      if (secondSeparatorIndex !== -1) {
        // Extract content between ⚠️ and second separator
        const warningContent = text.slice(warningIndex, secondSeparatorIndex).trim();
        
        // Append warning content to main content
        if (warningContent) {
          mainContent = mainContent + '\n\n' + warningContent;
        }
      }
    }
    
    return mainContent;
  }

  private async sendVoiceNotes(
    phoneNumber: string,
    messageId: string,
    text: string,
    languageCode: string | null,
  ): Promise<void> {
    if (!text.trim()) return;

    try {
      const audioBuffers = await this.sarvamService.synthesizeChunks(
        text,
        languageCode,
      );

      this.logger.log(
        `[${phoneNumber}] TTS produced ${audioBuffers.length} voice segment(s) for ${text.length} chars`,
      );

      for (let i = 0; i < audioBuffers.length; i++) {
        const bytes = audioBuffers[i].length;
        const uploadedMediaId = await this.whatsappService.uploadMedia(
          audioBuffers[i],
          'audio/ogg',
        );

        await this.whatsappService.sendVoiceMessage(
          phoneNumber,
          uploadedMediaId,
          i === 0 ? messageId : undefined,
        );

        this.logger.debug(
          `[${phoneNumber}] Voice segment ${i + 1}/${audioBuffers.length} sent (${bytes} bytes)`,
        );

        if (i < audioBuffers.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }
    } catch (err: any) {
      this.logger.error(
        `[${phoneNumber}] Voice reply failed — user will still get text: ${err?.message ?? err}`,
      );
      await this.whatsappService.sendTextMessage(
        phoneNumber,
        'Currently we are not taking audio questions, please type your questions. The audio services will resume soon.',
        messageId,
      );
    }
  }
}
