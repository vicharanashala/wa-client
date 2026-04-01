import {
  EventBus,
  EventPublisher,
  EventsHandler,
  IEventHandler,
} from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import {
  BotTextMessageAddedEvent,
  ConversationClearedEvent,
  ConversationCreatedEvent,
  UserMessageAddedEvent,
  UserTextMessageAddedEvent,
} from './conversation.events';
import { WhatsappService } from '../../whatsapp-api/whatsapp.service';
import { ConversationRepository } from '../infrastructure/conversation.repository';
import { toBaseMessages } from '../../llm/message.mapper';
import { LlmService } from '../../llm/llm.service';
import { HumanMessage } from '@langchain/core/messages';
import { UserTextMessageAddedHandler } from './event-handlers/user-text-message-added.event-handler';
import { BotTextMessageAddedHandler } from './event-handlers/bot-text-message-added.event-handler';
import { UserVoiceMessageAddedHandler } from './event-handlers/user-voice-message-added.event-handler';

@EventsHandler(ConversationCreatedEvent)
export class ConversationCreatedHandler implements IEventHandler<ConversationCreatedEvent> {
  private readonly logger = new Logger(ConversationCreatedHandler.name);

  handle(event: ConversationCreatedEvent): void {
    this.logger.log(`New conversation started for ${event.phoneNumber}`);
  }
}


@EventsHandler(ConversationClearedEvent)
export class ConversationClearedHandler implements IEventHandler<ConversationClearedEvent> {
  private readonly logger = new Logger(ConversationClearedHandler.name);

  handle(event: ConversationClearedEvent): void {
    this.logger.log(`Conversation cleared for ${event.phoneNumber}`);
  }
}

export const ConversationEventHandlers = [
  ConversationCreatedHandler,
  UserTextMessageAddedHandler,
  UserVoiceMessageAddedHandler,
  BotTextMessageAddedHandler,
  ConversationClearedHandler,
];
