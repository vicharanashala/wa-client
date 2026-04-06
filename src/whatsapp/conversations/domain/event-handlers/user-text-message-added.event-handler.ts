import { EventPublisher, EventsHandler, IEventHandler } from '@nestjs/cqrs';
import {
  BotTextMessageAddedEvent,
  ConversationClearedEvent,
  UserMessageAddedEvent,
  UserTextMessageAddedEvent,
} from '../conversation.events';
import { Logger } from '@nestjs/common';
import { WhatsappService } from '../../../whatsapp-api/whatsapp.service';
import { ConversationCreatedHandler } from '../conversation.event-handlers';
import { ConversationRepository } from '../../infrastructure/conversation.repository';
import { LlmService } from '../../../llm/llm.service';
import { toBaseMessages } from '../../../llm/message.mapper';
import { HumanMessage } from '@langchain/core/messages';

@EventsHandler(UserTextMessageAddedEvent)
export class UserTextMessageAddedHandler implements IEventHandler<UserMessageAddedEvent> {
  private readonly logger = new Logger(UserTextMessageAddedHandler.name);

  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly llmService: LlmService,
    private readonly whatsappService: WhatsappService,
  ) {}

  async handle(event: UserTextMessageAddedEvent): Promise<void> {
    this.logger.debug(
      `[${event.phoneNumber}] User: "${event.content.slice(0, 60)}"`,
    );

    try {
      await this.whatsappService.showTyping(event.messageId);
    } catch (err) {
      this.logger.warn(`showTyping failed for ${event.messageId}: ${err}`);
    }

    const conversation = await this.conversationRepository.findByPhone(
      event.phoneNumber,
    );
    if (!conversation) {
      this.logger.warn(`No conversation found for ${event.phoneNumber}, skipping`);
      return;
    }

    // Ask for location once if not yet provided
    if (!conversation.hasLocation) {
      this.logger.log(`[${event.phoneNumber}] No location yet, sending location request`);
      await this.whatsappService.sendLocationRequest(event.phoneNumber);
      return;
    }

    // Convert stored messages → LangChain HumanMessage / AIMessage
    const messages = toBaseMessages(conversation.messages);

    // Inject location context so LLM always knows the user's location
    if (conversation.location) {
      const { latitude, longitude, address } = conversation.location;
      messages.unshift(
        new HumanMessage(
          `My location: latitude ${latitude}, longitude ${longitude}${address ? `, address: ${address}` : ''}.`,
        ),
      );
    }

    this.eventPublisher.mergeObjectContext(conversation);

    // Generate reply using full typed message history
    const { reply, toolCalls, toolResults } =
      await this.llmService.generate(messages);

    // Store tool calls
    for (const tc of toolCalls) {
      conversation.addToolCall(tc.toolCallId, tc.toolName, tc.input);
    }

    // Store tool results
    for (const tr of toolResults) {
      conversation.addToolResult(tr.toolCallId, tr.toolName, tr.result);
    }

    // Store bot reply via aggregate domain method
    conversation.addBotTextMessage(reply);
    await this.conversationRepository.save(conversation);

    // Fires BotMessageAddedEvent → BotMessageAddedHandler → WhatsApp send
    conversation.commit();

    await this.whatsappService.sendTextMessage(
      event.phoneNumber,
      reply,
      event.messageId
    );
    this.logger.log(
      `[${event.phoneNumber}] Sent: "${reply.slice(0, 60)}"`,
    );
  }
}

