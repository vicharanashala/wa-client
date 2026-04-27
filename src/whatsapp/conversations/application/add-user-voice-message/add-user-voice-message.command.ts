import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { LangGraphClientService } from '../../langgraph-client.service';
import { SarvamService } from '../../../sarvam-api/sarvam.service';
import { WhatsappService } from '../../../whatsapp-api/whatsapp.service';

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
  ) {}

  async execute(command: AddUserVoiceMessageCommand): Promise<void> {
    const { phoneNumber, mediaId, messageId } = command;

    // 1. Show typing indicator
    await this.whatsappService.showTyping(messageId);

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
    const { reply } = await this.langGraph.sendMessage(phoneNumber, transcript);

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
