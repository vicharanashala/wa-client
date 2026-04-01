import { CommandHandler, EventPublisher, ICommandHandler } from '@nestjs/cqrs';
import { Conversation } from '../../domain/conversation';
import { ConversationRepository } from '../../infrastructure/conversation.repository';
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
export class AddUserVoiceMessageHandler implements ICommandHandler<AddUserVoiceMessageCommand> {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly sarvamService: SarvamService,
    private readonly whatsappService: WhatsappService,
    private readonly eventPublisher: EventPublisher,
  ) {}

  async execute(command: AddUserVoiceMessageCommand): Promise<void> {
    const { phoneNumber, mediaId, messageId } = command;

    // 1. Download audio from WhatsApp
    const { buffer, mimeType } =
      await this.whatsappService.downloadMedia(mediaId);

    // 2. Transcribe to English + detect language
    const { transcript, languageCode } =
      await this.sarvamService.transcribeToEnglish(buffer, mimeType);

    // 4. Store voice message with transcript (audioStorageUrl = undefined for now)
    const conversation =
      (await this.conversationRepository.findByPhone(phoneNumber)) ??
      Conversation.create(phoneNumber);

      this.eventPublisher.mergeObjectContext(conversation);

    if (languageCode) {
      conversation.setPreferredLanguage(languageCode);
    }

    conversation.addUserVoiceMessage(
      transcript,
      messageId,
      undefined,
    );

    await this.conversationRepository.save(conversation);

    conversation.commit(); // fires UserVoiceMessageAddedEvent
  }
}
