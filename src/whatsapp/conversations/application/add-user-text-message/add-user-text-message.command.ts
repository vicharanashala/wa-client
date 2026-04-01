import { ConversationRepository } from '../../infrastructure/conversation.repository';
import {
  CommandHandler,
  EventBus,
  EventPublisher,
  ICommandHandler,
} from '@nestjs/cqrs';
import { Conversation } from '../../domain/conversation';

export class AddUserTextMessageCommand {
  constructor(
    public readonly phoneNumber: string,
    public readonly content: string,
    public readonly messageId: string
  ) {}
}


@CommandHandler(AddUserTextMessageCommand)
export class AddUserTextMessageHandler implements ICommandHandler<AddUserTextMessageCommand> {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly eventPublisher: EventPublisher,
  ) {}

  async execute(command: AddUserTextMessageCommand): Promise<void> {
    const { phoneNumber, content, messageId } = command;

    const conversation =
      (await this.conversationRepository.findByPhone(phoneNumber)) ??
      Conversation.create(phoneNumber);

    this.eventPublisher.mergeObjectContext(conversation);

    conversation.addUserTextMessage(content, messageId);

    await this.conversationRepository.save(conversation);

    conversation.commit();
  }
}
