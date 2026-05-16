import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { LangGraphClientService } from '../../langgraph-client.service';
import { SarvamService } from '../../../sarvam-api/sarvam.service';
import { WhatsappService } from '../../../whatsapp-api/whatsapp.service';
import { PendingQuestionRepository } from '../../../pending-questions/pending-question.repository';

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
  ) {}

  async execute(command: AddUserVoiceMessageCommand): Promise<void> {
    const { phoneNumber, mediaId, messageId } = command;

    await this.langGraph.prepareDailyThread(phoneNumber);

    await this.whatsappService.showTyping(messageId);

    const hasLocation = await this.langGraph.hasLocation(phoneNumber);
    if (!hasLocation) {
      this.logger.log(`[${phoneNumber}] No location in thread state — requesting location`);
      await this.whatsappService.sendLocationRequest(phoneNumber);
      return;
    }

    const { buffer, mimeType } =
      await this.whatsappService.downloadMedia(mediaId);

    const { transcript, languageCode } =
      await this.sarvamService.transcribeToEnglish(buffer, mimeType);

    this.logger.debug(
      `[${phoneNumber}] Voice transcribed: "${transcript.slice(0, 60)}" (lang=${languageCode})`,
    );

    const { reply, reviewId } = await this.langGraph.sendMessage(phoneNumber, transcript);

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
    const maxChars = TTS_CHARS_PER_VOICE_NOTE * MAX_VOICE_NOTES;
    if (reply.length <= maxChars) return reply;
    this.logger.warn(
      `Reply length ${reply.length} exceeds voice cap ${maxChars} — TTS will cover first ${maxChars} chars only; full answer sent as text.`,
    );
    return reply.slice(0, maxChars);
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
    }
  }
}
