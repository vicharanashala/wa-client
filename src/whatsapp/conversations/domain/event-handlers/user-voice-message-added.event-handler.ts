import { EventPublisher, EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { UserVoiceMessageAddedEvent } from '../conversation.events';
import { ConversationRepository } from '../../infrastructure/conversation.repository';
import { LlmService } from '../../../llm/llm.service';
import { SarvamService } from '../../../sarvam-api/sarvam.service';
import { WhatsappService } from '../../../whatsapp-api/whatsapp.service';
import { toBaseMessages } from '../../../llm/message.mapper';
import { HumanMessage } from '@langchain/core/messages';

@EventsHandler(UserVoiceMessageAddedEvent)
export class UserVoiceMessageAddedHandler implements IEventHandler<UserVoiceMessageAddedEvent> {
  private readonly logger = new Logger(UserVoiceMessageAddedHandler.name);

  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly llmService: LlmService,
    private readonly sarvamService: SarvamService,
    private readonly whatsappService: WhatsappService,
  ) {}

  async handle(event: UserVoiceMessageAddedEvent): Promise<void> {
    this.logger.debug(
      `[${event.phoneNumber}] Voice (transcribed): "${event.transcript.slice(0, 60)}"`,
    );

    await this.whatsappService.showTyping(event.messageId);

    const conversation = await this.conversationRepository.findByPhone(
      event.phoneNumber,
    );
    if (!conversation) return;

    if (!conversation.hasLocation) {
      await this.whatsappService.sendLocationRequest(event.phoneNumber);
      return;
    }

    // Build message history from DB
    const messages = toBaseMessages(conversation.messages);

    // Inject location context
    if (conversation.location) {
      const { latitude, longitude, address } = conversation.location;
      messages.unshift(
        new HumanMessage(
          `My location: latitude ${latitude}, longitude ${longitude}${address ? `, address: ${address}` : ''}.`,
        ),
      );
    }

    this.eventPublisher.mergeObjectContext(conversation);

    // Generate reply from LLM
    const { reply, toolCalls, toolResults } =
      await this.llmService.generate(messages);

    for (const tc of toolCalls) {
      conversation.addToolCall(tc.toolCallId, tc.toolName, tc.input);
    }

    for (const tr of toolResults) {
      conversation.addToolResult(tr.toolCallId, tr.toolName, tr.result);
    }

    conversation.addBotTextMessage(reply);
    await this.conversationRepository.save(conversation);
    conversation.commit();

    // Convert reply to speech in user's detected language
    const audioBuffer = await this.sarvamService.synthesize(
      reply,
      conversation.preferredLanguage ?? null,
    );

    // Upload to WhatsApp and send as voice note
    const mediaId = await this.whatsappService.uploadMedia(
      audioBuffer,
      'audio/ogg',
    );

    await this.whatsappService.sendVoiceMessage(event.phoneNumber, mediaId, event.messageId);

    await this.whatsappService.sendTextMessage(
      event.phoneNumber,
      reply,
      event.messageId,
    );
    this.logger.log(
      `[${event.phoneNumber}] Sent: "${reply.slice(0, 60)}"`,
    );

    this.logger.log(
      `[${event.phoneNumber}] Sent voice reply (${conversation.preferredLanguage ?? 'default'})`,
    );
  }
}
