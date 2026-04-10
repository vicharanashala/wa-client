import { EventPublisher, EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { UserTextMessageAddedEvent } from '../conversation.events';
import { Logger } from '@nestjs/common';
import { WhatsappService } from '../../../whatsapp-api/whatsapp.service';
import { ConversationRepository } from '../../infrastructure/conversation.repository';
import { LlmService } from '../../../llm/llm.service';
import { toBaseMessages } from '../../../llm/message.mapper';
import { HumanMessage } from '@langchain/core/messages';
import { Result } from 'oxide.ts';

@EventsHandler(UserTextMessageAddedEvent)
export class UserTextMessageAddedHandler implements IEventHandler<UserTextMessageAddedEvent> {
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

    await this.showTypingIndicator(event.messageId, event.phoneNumber);

    const conversation = await this.conversationRepository.findByPhone(
      event.phoneNumber,
    );

    if (!conversation) {
      this.logger.warn(
        `No conversation found for ${event.phoneNumber}, skipping`,
      );
      return;
    }

    if (!conversation.hasLocation) {
      this.logger.log(
        `[${event.phoneNumber}] No location yet, sending location request`,
      );
      await this.whatsappService.sendLocationRequest(event.phoneNumber);
      return;
    }

    const messages = this.buildMessageHistory(conversation);

    this.eventPublisher.mergeObjectContext(conversation);

    const { reply, toolCalls, toolResults } =
      await this.llmService.generate(messages);

    this.storeToolInteractions(conversation, toolCalls, toolResults);

    conversation.addBotTextMessage(reply);
    await this.conversationRepository.save(conversation);

    conversation.commit();

    await this.sendReply(event.phoneNumber, reply, event.messageId);
  }

  private async showTypingIndicator(
    messageId: string,
    phoneNumber: string,
  ): Promise<void> {
    const result = await Result.safe(
      this.whatsappService.showTyping(messageId),
    );

    result.isErr() &&
      this.logger.warn(
        `[${phoneNumber}] showTyping failed: ${result.unwrapErr().message}`,
      );
  }

  private buildMessageHistory(conversation: any): any[] {
    const messages = toBaseMessages(conversation.messages.slice(-15));

    if (conversation.location) {
      const { latitude, longitude, address } = conversation.location;
      messages.unshift(
        new HumanMessage(
          `My location: latitude ${latitude}, longitude ${longitude}${address ? `, address: ${address}` : ''}.`,
        ),
      );
    }

    return messages;
  }

  private storeToolInteractions(
    conversation: any,
    toolCalls: any[],
    toolResults: any[],
  ): void {
    for (const tc of toolCalls) {
      conversation.addToolCall(tc.toolCallId, tc.toolName, tc.input);
    }

    for (const tr of toolResults) {
      conversation.addToolResult(tr.toolCallId, tr.toolName, tr.result);
    }
  }

  private async sendReply(
    phoneNumber: string,
    reply: string,
    messageId: string,
  ): Promise<void> {
    await this.whatsappService.sendTextMessage(phoneNumber, reply, messageId);
    this.logger.log(`[${phoneNumber}] Sent: "${reply.slice(0, 60)}"`);
  }
}
