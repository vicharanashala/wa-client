import { EventPublisher, EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { UserVoiceMessageAddedEvent } from '../conversation.events';
import { ConversationRepository } from '../../infrastructure/conversation.repository';
import { LlmService } from '../../../llm/llm.service';
import { SarvamService } from '../../../sarvam-api/sarvam.service';
import { WhatsappService } from '../../../whatsapp-api/whatsapp.service';
import { toBaseMessages } from '../../../llm/message.mapper';
import { HumanMessage } from '@langchain/core/messages';
import { PendingQuestionRepository } from '../../../pending-questions/pending-question.repository';
import { AegraService } from '../../../aegra/aegra.service';

/** Name of the MCP tool that uploads questions to the reviewer system */
const REVIEWER_UPLOAD_TOOL = 'upload_question_to_reviewer_system';

@EventsHandler(UserVoiceMessageAddedEvent)
export class UserVoiceMessageAddedHandler implements IEventHandler<UserVoiceMessageAddedEvent> {
  private readonly logger = new Logger(UserVoiceMessageAddedHandler.name);

  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly llmService: LlmService,
    private readonly sarvamService: SarvamService,
    private readonly whatsappService: WhatsappService,
    private readonly pendingQuestionRepo: PendingQuestionRepository,
    private readonly aegraService: AegraService,
  ) { }

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

    const messages = toBaseMessages(conversation.messages.slice(-15));

    if (conversation.location) {
      const { latitude, longitude, address } = conversation.location;
      messages.unshift(
        new HumanMessage(
          `My location: latitude ${latitude}, longitude ${longitude}${address ? `, address: ${address}` : ''}.`,
        ),
      );
    }

    this.eventPublisher.mergeObjectContext(conversation);

    /*
    const { reply, toolCalls, toolResults } =
      await this.llmService.generate(messages);

    for (const tc of toolCalls) {
      conversation.addToolCall(tc.toolCallId, tc.toolName, tc.input);
    }

    for (const tr of toolResults) {
      conversation.addToolResult(tr.toolCallId, tr.toolName, tr.result);
    }

    await this.trackReviewerUploads(toolCalls, toolResults, event.phoneNumber);

    conversation.addBotTextMessage(reply);
    await this.conversationRepository.save(conversation);
    conversation.commit();

    const audioBuffer = await this.sarvamService.synthesize(
      reply,
      conversation.preferredLanguage ?? null,
    );

    const mediaId = await this.whatsappService.uploadMedia(
      audioBuffer,
      'audio/ogg',
    );

    await this.whatsappService.sendVoiceMessage(
      event.phoneNumber,
      mediaId,
      event.messageId,
    );

    await this.whatsappService.sendTextMessage(
      event.phoneNumber,
      reply,
      event.messageId,
    );
    */
    /*
    this.logger.log(`[${event.phoneNumber}] Sent: "${reply.slice(0, 60)}"`);

    this.logger.log(
      `[${event.phoneNumber}] Sent voice reply (${conversation.preferredLanguage ?? 'default'})`,
    );
    */

    try {
      if (!conversation.threadId) {
        this.logger.log(`[${event.phoneNumber}] No thread ID found. Creating a new thread on Aegra.`);
        const threadId = await this.aegraService.createThread(event.phoneNumber);
        conversation.setThreadId(threadId);
        await this.conversationRepository.save(conversation);
        this.logger.log(`[${event.phoneNumber}] Thread created: ${threadId}`);
      }

      // Include location in message if needed. Since Aegra might just need the input string:
      let messageToSend = event.transcript;
      if (conversation.location) {
        const { latitude, longitude, address } = conversation.location;
        messageToSend = `[My location: latitude ${latitude}, longitude ${longitude}${address ? `, address: ${address}` : ''}] ${event.transcript}`;
      }

      const reply = await this.aegraService.sendMessageAndWait(
        conversation.threadId!,
        messageToSend
      );

      conversation.addBotTextMessage(reply);
      await this.conversationRepository.save(conversation);
      conversation.commit();

      const audioBuffer = await this.sarvamService.synthesize(
        reply,
        conversation.preferredLanguage ?? null,
      );

      const mediaId = await this.whatsappService.uploadMedia(
        audioBuffer,
        'audio/ogg',
      );

      await this.whatsappService.sendVoiceMessage(
        event.phoneNumber,
        mediaId,
        event.messageId,
      );

      await this.whatsappService.sendTextMessage(
        event.phoneNumber,
        reply,
        event.messageId,
      );

      this.logger.log(`[${event.phoneNumber}] Sent: "${reply.slice(0, 60)}"`);
      this.logger.log(
        `[${event.phoneNumber}] Sent voice reply (${conversation.preferredLanguage ?? 'default'})`,
      );

    } catch (error: any) {
      this.logger.error(`[${event.phoneNumber}] Failed to process voice message with Aegra: ${error.message}`);
      await this.whatsappService.sendTextMessage(
        event.phoneNumber, 
        'I am currently experiencing issues connecting to my brain. Please try again later.', 
        event.messageId
      );
    }
  }

  /**
   * Scans tool calls/results for the reviewer upload tool.
   * If found, extracts the question_id from the result and creates a
   * pending question record so the polling service can track it.
   */
  private async trackReviewerUploads(
    toolCalls: { toolCallId: string; toolName: string; input: string }[],
    toolResults: { toolCallId: string; toolName: string; result: string }[],
    phoneNumber: string,
  ): Promise<void> {
    const reviewerCalls = toolCalls.filter(
      (tc) => tc.toolName === REVIEWER_UPLOAD_TOOL,
    );

    for (const call of reviewerCalls) {
      const result = toolResults.find(
        (tr) => tr.toolCallId === call.toolCallId,
      );
      if (!result) continue;

      try {
        const parsed = JSON.parse(result.result);
        const questionId =
          parsed.question_id || parsed.questionId || parsed.id || parsed._id;

        if (!questionId) {
          this.logger.warn(
            `[${phoneNumber}] Reviewer upload succeeded but no question_id in response: ${result.result}`,
          );
          continue;
        }

        let queryText = '';
        try {
          const inputParsed = JSON.parse(call.input);
          queryText =
            inputParsed.question ||
            inputParsed.query ||
            inputParsed.text ||
            inputParsed.query_text ||
            JSON.stringify(inputParsed);
        } catch {
          queryText = call.input;
        }

        await this.pendingQuestionRepo.create({
          questionId,
          phoneNumber,
          queryText,
          toolCallId: call.toolCallId,
        });

        this.logger.log(
          `[${phoneNumber}] 📋 Pending question tracked: ${questionId} — "${queryText.slice(0, 60)}"`,
        );
      } catch (err: any) {
        this.logger.error(
          `[${phoneNumber}] Failed to track reviewer upload: ${err.message}`,
        );
      }
    }
  }
}
