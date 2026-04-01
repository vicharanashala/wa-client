// set-user-location.command.ts
import {
  CommandHandler,
  EventBus,
  EventPublisher,
  ICommandHandler,
} from '@nestjs/cqrs';
import { ConversationRepository } from '../../infrastructure/conversation.repository';
import { WhatsappService } from '../../../whatsapp-api/whatsapp.service';
import { Conversation } from '../../domain/conversation';

export class SetUserLocationCommand {
  constructor(
    public readonly phoneNumber: string,
    public readonly messageId: string,
    public readonly latitude: number,
    public readonly longitude: number,
    public readonly address?: string,
  ) {}
}

// set-user-location.handler.ts
@CommandHandler(SetUserLocationCommand)
export class SetUserLocationHandler implements ICommandHandler<SetUserLocationCommand> {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly whatsappService: WhatsappService,
    private readonly eventPublisher: EventPublisher
  ) {}

  async execute(command: SetUserLocationCommand): Promise<void> {
    const { phoneNumber, messageId, latitude, longitude, address } = command;

    const conversation =
      (await this.conversationRepository.findByPhone(phoneNumber)) ??
      Conversation.create(phoneNumber);

    this.eventPublisher.mergeObjectContext(conversation);

    conversation.setLocation(latitude, longitude, address);
    await this.conversationRepository.save(conversation);

    conversation.commit();

    // Acknowledge and prompt them to continue
    await this.whatsappService.markAsRead(messageId);
    await this.whatsappService.sendTextMessage(
      phoneNumber,
      'Thank you! Location saved. You can now ask your farming question.',
    );
  }
}
