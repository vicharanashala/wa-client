import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { LangGraphClientService } from '../../langgraph-client.service';
import { SarvamService } from '../../../sarvam-api/sarvam.service';
import { WhatsappService } from '../../../whatsapp-api/whatsapp.service';
import { PendingQuestionRepository } from '../../../pending-questions/pending-question.repository';

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

    // Ensure daily thread handover is completed (IST day boundary).
    await this.langGraph.prepareDailyThread(phoneNumber);

    // 1. Show typing indicator
    await this.whatsappService.showTyping(messageId);

    // Gate: require location before proceeding
    const hasLocation = await this.langGraph.hasLocation(phoneNumber);
    if (!hasLocation) {
      this.logger.log(`[${phoneNumber}] No location in thread state — requesting location`);
      await this.whatsappService.sendLocationRequest(phoneNumber);
      return;
    }

    // 2. Download audio from WhatsApp
    const { buffer, mimeType } =
      await this.whatsappService.downloadMedia(mediaId);

    // 3. Transcribe to English + detect language
    const { transcript, languageCode } =
      await this.sarvamService.transcribeToEnglish(buffer, mimeType);

    this.logger.debug(
      `[${phoneNumber}] Voice transcribed: "${transcript.slice(0, 60)}" (lang=${languageCode})`,
    );

    // 4. Send transcript to LangGraph; thread reused by phone number
    const { reply, reviewId } = await this.langGraph.sendMessage(phoneNumber, transcript);

    // If LangGraph flagged this for human review, save to pending_questions
    if (reviewId) {
      await this.pendingQuestionRepo.create({
        questionId: reviewId,
        phoneNumber,
        queryText: transcript,
        toolCallId: `force-${Date.now()}`,
        originalMessageId: messageId,
      });
      this.logger.log(
        `[${phoneNumber}] 📝 Pending question created — REV_ID: ${reviewId}`,
      );
    }

    // 5. Synthesize voice reply and send audio + text
    const audioBuffer = await this.sarvamService.synthesize(
      reply,
      languageCode ?? null,
    );

    const uploadedMediaId = await this.whatsappService.uploadMedia(
      audioBuffer,
      'audio/ogg',
    );

    await this.whatsappService.sendVoiceMessage(
      phoneNumber,
      uploadedMediaId,
      messageId,
    );

    await this.whatsappService.sendTextMessage(phoneNumber, reply, messageId);

    this.logger.log(
      `[${phoneNumber}] Sent voice+text reply (lang=${languageCode ?? 'default'}): "${reply.slice(0, 60)}"`,
    );
  }
}
