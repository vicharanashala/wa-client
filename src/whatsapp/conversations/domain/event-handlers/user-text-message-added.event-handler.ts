import { EventPublisher, EventsHandler, IEventHandler } from '@nestjs/cqrs';
import {
  BotTextMessageAddedEvent,
  ConversationClearedEvent,
  UserTextMessageAddedEvent,
} from '../conversation.events';
import { Logger } from '@nestjs/common';
import { WhatsappService } from '../../../whatsapp-api/whatsapp.service';
import { ConversationCreatedHandler } from '../conversation.event-handlers';
import { ConversationRepository } from '../../infrastructure/conversation.repository';
import { LlmService } from '../../../llm/llm.service';
import { toBaseMessages } from '../../../llm/message.mapper';
import { HumanMessage } from '@langchain/core/messages';
import { PendingQuestionRepository } from '../../../pending-questions/pending-question.repository';

/** Name of the MCP tool that uploads questions to the reviewer system */
const REVIEWER_UPLOAD_TOOL = 'upload_question_to_reviewer_system';

@EventsHandler(UserTextMessageAddedEvent)
export class UserTextMessageAddedHandler implements IEventHandler<UserTextMessageAddedEvent> {
  private readonly logger = new Logger(UserTextMessageAddedHandler.name);

  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly llmService: LlmService,
    private readonly whatsappService: WhatsappService,
    private readonly pendingQuestionRepo: PendingQuestionRepository,
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
    const messages = toBaseMessages(conversation.messages.slice(-15));

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

    // ── Force-call reviewer upload if LLM skipped it ──
    const hasReviewerCall = toolCalls.some(
      (tc) =>
        tc.toolName === REVIEWER_UPLOAD_TOOL ||
        tc.toolName === 'upload_to_reviewer_system' ||
        tc.toolName === 'upload_question',
    );

    if (!hasReviewerCall) {
      this.logger.warn(
        `[${event.phoneNumber}] LLM did NOT call ${REVIEWER_UPLOAD_TOOL} — force-calling now`,
      );
      try {
        const forceInput = {
          question: event.content,
          state_name: "General",
          crop: "General",
          details: {
            state: "General",
            district: "General",
            crop: "General",
            season: "General",
            domain: "General"
          }
        };

        const forceResult = await this.llmService.callTool(
          REVIEWER_UPLOAD_TOOL,
          forceInput,
        );
        const forceCallId = `force-${Date.now()}`;
        toolCalls.push({
          toolCallId: forceCallId,
          toolName: REVIEWER_UPLOAD_TOOL,
          input: JSON.stringify(forceInput),
        });
        toolResults.push({
          toolCallId: forceCallId,
          toolName: REVIEWER_UPLOAD_TOOL,
          result: forceResult,
        });
        this.logger.log(
          `[${event.phoneNumber}] ✅ Force-called ${REVIEWER_UPLOAD_TOOL} — result: ${forceResult.slice(0, 200)}`,
        );
      } catch (err: any) {
        this.logger.error(
          `[${event.phoneNumber}] ❌ Force-call ${REVIEWER_UPLOAD_TOOL} failed: ${err.message}`,
        );
      }
    }

    // ── Track reviewer uploads for async notification ──
    await this.trackReviewerUploads(toolCalls, toolResults, event.phoneNumber);

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

    this.logger.log(`Tracking reviewer uploads for ${phoneNumber}. Found ${toolCalls.length} total tool calls.`);
    for (const tc of toolCalls) {
      this.logger.log(`Executed tool: ${tc.toolName} with input: ${tc.input}`);
    }

    const reviewerCalls = toolCalls.filter(
      (tc) => tc.toolName === REVIEWER_UPLOAD_TOOL || tc.toolName === 'upload_to_reviewer_system' || tc.toolName === 'upload_question',
    );

    this.logger.log(`Found ${reviewerCalls.length} reviewer tool calls.`);

    for (const call of reviewerCalls) {
      const result = toolResults.find(
        (tr) => tr.toolCallId === call.toolCallId,
      );
      if (!result) {
        this.logger.warn(`No result found for reviewer call: ${call.toolCallId}`);
        continue;
      }

      this.logger.log(`RAW REVIEWER UPLOAD RESULT for ${phoneNumber}: ${result.result}`);

      let questionId;
      try {
        let parsed = JSON.parse(result.result);
        if (typeof parsed === 'string') {
           parsed = JSON.parse(parsed); // Handle double encoding
        }

        // Deep search for ID if nested
        questionId = parsed.question_id || parsed.questionId || parsed.id || parsed._id;
        if (!questionId && parsed.data) {
           questionId = parsed.data.question_id || parsed.data.questionId || parsed.data.id || parsed.data._id;
        }
        if (!questionId && parsed.result) {
           questionId = parsed.result.question_id || parsed.result.questionId || parsed.result.id || parsed.result._id;
        }
      } catch (err) {
        // Ignored
      }

      // Fallbacks if JSON parsing failed or didn't yield an ID
      if (!questionId) {
        const idMatch = String(result.result).match(/([a-fA-F0-9]{24})|([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})/);
        if (idMatch) {
          questionId = idMatch[0];
        } else {
           const numericMatch = String(result.result).match(/id\s*[:=]\s*['"]?([a-zA-Z0-9_-]+)['"]?/i) ||
                                String(result.result).match(/"id"\s*:\s*["']?([a-zA-Z0-9_-]+)["']?/i) ||
                                String(result.result).match(/question_id\s*[:=]\s*['"]?([a-zA-Z0-9_-]+)['"]?/i);
           if (numericMatch) questionId = numericMatch[1];
        }
      }

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

      try {
        await this.pendingQuestionRepo.create({
          questionId,
          phoneNumber,
          queryText,
          toolCallId: call.toolCallId,
        });

        console.log(`\n======================================================`);
        console.log(`🚀 SUCCESSFULLY UPLOADED TO REVIEWER BASE (EXPERT SYSTEM)!`);
        console.log(`📱 PHONE NUMBER: ${phoneNumber}`);
        console.log(`📝 QUESTION ID : ${questionId}`);
        console.log(`======================================================\n`);

        this.logger.log(
          `[${phoneNumber}] 📋 Pending question tracked: ${questionId} — "${queryText.slice(0, 60)}"`,
        );
      } catch (err: any) {
        this.logger.error(
          `[${phoneNumber}] Failed to track reviewer upload in DB: ${err.message}`,
        );
      }
    }
  }
}

