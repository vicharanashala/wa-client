import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client} from '@langchain/langgraph-sdk';
export interface SendMessageResult {
  reply: string;
  reviewId?: string; // Extracted from |||REV_ID:xxx||| if present
}

/**
 * Thin wrapper around the LangGraph SDK Client.
 *
 * Design decisions:
 * - One thread per phone number; thread_id === phone number.
 * - Threads are created idempotently (`if_exists: "do_nothing"`).
 * - Runs are executed via client.runs.wait() — blocks until the graph
 *   finishes and returns the final state directly, no stream parsing needed.
 * - LANGGRAPH_BASE_URL and LANGGRAPH_ASSISTANT_ID come from env vars.
 */
@Injectable()
export class LangGraphClientService implements OnModuleInit {
  private readonly logger = new Logger(LangGraphClientService.name);
  private static readonly KOLKATA_TZ = 'Asia/Kolkata';
  private client: Client;
  private assistantId: string;
  private summaryAssistantId: string;
  private assistantGraphId?: string;

  async onModuleInit(): Promise<void> {
    const apiUrl = process.env.AEGRA_BASE_URL;
    this.assistantId = process.env.AEGRA_ASSISTANT_ID ?? '';
    this.summaryAssistantId =
      process.env.AEGRA_SUMMARY_ASSISTANT_ID ?? 'summary_agent';

    if (!this.assistantId) {
      this.logger.error(
        'AEGRA_ASSISTANT_ID env var is not set. Conversation routing will fail.',
      );
    }

    this.client = new Client({ apiUrl });
    await this.resolveAssistantGraphId();

    this.logger.log(
      `LangGraph client initialised — baseUrl=${apiUrl ?? 'http://localhost:8123 (default)'}, assistantId=${this.assistantId}`,
    );
  }

  private async resolveAssistantGraphId(): Promise<void> {
    if (!this.assistantId) return;
    try {
      const assistant = await this.client.assistants.get(this.assistantId);
      const graphId =
        (assistant as any)?.graphId ?? (assistant as any)?.graph_id;
      if (typeof graphId === 'string' && graphId.trim()) {
        this.assistantGraphId = graphId;
      }
    } catch (err: any) {
      this.logger.warn(
        `Could not resolve graph ID for assistant ${this.assistantId}: ${err?.message}`,
      );
    }
  }

  private buildThreadMetadata(phoneNumber: string): Record<string, any> {
    return {
      userId: phoneNumber,
      phoneNumber,
      user_id: phoneNumber,
      langfuse_user_id: phoneNumber,
      channel: 'whatsapp',
    };
  }

  /**
   * Every WhatsApp-driven `runs.wait` gets the same user identity: WhatsApp phone number.
   * Applied for normal messages, retries, location updates, daily summary, etc.
   * Session/thread hints (`langfuse_session_id`) only apply when `extra.threadId` is set.
   */
  private buildRunMetadata(
    phoneNumber: string,
    event: string,
    extra: Record<string, any> = {},
  ): Record<string, any> {
    const threadId =
      typeof extra.threadId === 'string' && extra.threadId.trim()
        ? extra.threadId.trim()
        : undefined;

    return {
      channel: 'whatsapp',
      event,
      ...extra,
      userId: phoneNumber,
      phoneNumber,
      user_id: phoneNumber,
      langfuse_user_id: phoneNumber,
      ...(threadId
        ? {
            thread_id: threadId,
            langfuse_session_id: threadId,
          }
        : {}),
    };
  }

  /**
   * Generates a thread ID based on phone number and current date.
   * Format: {phoneNumber}-YYYY-MM-DD
   */
  private getThreadId(phoneNumber: string): string {
    const dateStr = this.getKolkataDateString();
    return `${phoneNumber}-${dateStr}`;
  }

  private getThreadIdForDate(phoneNumber: string, dateStr: string): string {
    return `${phoneNumber}-${dateStr}`;
  }

  private getKolkataDateString(offsetDays = 0): string {
    const now = new Date();
    const shifted = new Date(
      now.getTime() + offsetDays * 24 * 60 * 60 * 1000,
    );
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: LangGraphClientService.KOLKATA_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(shifted);
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    return `${year}-${month}-${day}`;
  }

  /**
   * Daily handover flow:
   * - If today's thread already has state, no-op.
   * - If not, summarize yesterday thread (if any), store summary,
   *   and carry yesterday location into today's thread state.
   */
  async prepareDailyThread(phoneNumber: string): Promise<void> {
    const todayDate = this.getKolkataDateString();
    const yesterdayDate = this.getKolkataDateString(-1);
    const todayThreadId = this.getThreadIdForDate(phoneNumber, todayDate);
    const yesterdayThreadId = this.getThreadIdForDate(phoneNumber, yesterdayDate);

    try {
      await this.client.threads.getState(todayThreadId);
      return;
    } catch {
      this.logger.log(
        `[${phoneNumber}] First message for ${todayDate} IST — running daily handover`,
      );
    }

    await this.ensureThreadRecord(todayThreadId, phoneNumber);

    let yesterdayState: any;
    try {
      yesterdayState = await this.client.threads.getState(yesterdayThreadId);
    } catch {
      this.logger.debug(
        `[${phoneNumber}] No previous thread state for ${yesterdayDate}`,
      );
      return;
    }

    const yesterdayMessages: any[] = (yesterdayState?.values as any)?.messages ?? [];
    if (yesterdayMessages.length > 0) {
      try {
        const summaryRunOutput = await this.client.runs.wait(
          yesterdayThreadId,
          this.summaryAssistantId,
          {
            input: {
              messages: [
                {
                  role: 'human',
                  content:
                    'Summarize this conversation for long-term memory in about 100 words, focusing on farmer profile, preferences, crops, constraints, and unresolved needs.',
                },
              ],
            },
            metadata: this.buildRunMetadata(phoneNumber, 'daily_summary', {
              threadId: yesterdayThreadId,
              sourceThreadId: yesterdayThreadId,
              targetThreadId: todayThreadId,
              summaryDate: yesterdayDate,
            }),
          },
        );

        const summaryText = this.extractSummaryText(summaryRunOutput);
        if (summaryText) {
          await (this.client as any).store.putItem(
            ['farmer_profiles', phoneNumber],
            `daily_summary_${yesterdayDate}`,
            {
              date: yesterdayDate,
              summary: summaryText,
              sourceThreadId: yesterdayThreadId,
            },
          );
        }
      } catch (err: any) {
        this.logger.warn(
          `[${phoneNumber}] Failed daily summary/store handover: ${err?.message}`,
        );
      }
    }

    const yesterdayLocation = (yesterdayState?.values as any)?.location;
    if (
      yesterdayLocation &&
      (yesterdayLocation.latitude != null ||
        yesterdayLocation.longitude != null ||
        yesterdayLocation.city ||
        yesterdayLocation.state)
    ) {
      try {
        await this.setLocationOnThreadState(
          todayThreadId,
          yesterdayLocation,
          phoneNumber,
        );
        this.logger.log(
          `[${phoneNumber}] Carried location to new daily thread (${todayDate})`,
        );
      } catch (err: any) {
        this.logger.warn(
          `[${phoneNumber}] Failed to carry location to new thread: ${err?.message}`,
        );
      }
    }
  }

  /**
   * Ensure a persistent thread exists for the given phone number.
   * Uses the phone number and date as the thread ID so there is exactly
   * one thread per user per day.
   */
  async ensureThread(phoneNumber: string): Promise<string> {
    const threadId = this.getThreadId(phoneNumber);
    await this.ensureThreadRecord(threadId, phoneNumber);
    return threadId;
  }

  /**
   * Persist thread row on LangGraph server with a deterministic ID.
   * SDK expects camelCase (threadId / ifExists); snake_case is ignored.
   */
  private async ensureThreadRecord(
    threadId: string,
    phoneNumber: string,
  ): Promise<void> {
    await this.client.threads.create({
      threadId,
      ifExists: 'do_nothing',
      metadata: this.buildThreadMetadata(phoneNumber),
      ...(this.assistantGraphId ? { graphId: this.assistantGraphId } : {}),
    });
  }

  private async setLocationOnThreadState(
    threadId: string,
    location: any,
    phoneNumber: string,
  ): Promise<void> {
    try {
      await this.client.threads.updateState(threadId, {
        values: { location },
      });
    } catch (err: any) {
      const message = String(err?.message ?? '');
      // Some servers require a graph-associated checkpoint before updateState.
      if (message.includes('has no associated graph')) {
        await this.client.runs.wait(threadId, this.assistantId, {
          input: { location },
          multitaskStrategy: 'reject',
          metadata: this.buildRunMetadata(phoneNumber, 'location_handover', {
            threadId,
          }),
        });
        return;
      }
      throw err;
    }
  }

  /**
   * Returns true if the thread's state already has a location set.
   * Reads the `location` field from AjraSakhaState directly.
   * Returns false if the thread doesn't exist yet or has no state.
   */
  async hasLocation(phoneNumber: string): Promise<boolean> {
    const threadId = await this.ensureThread(phoneNumber);
    try {
      const state = await this.client.threads.getState(threadId);
      const location = (state?.values as any)?.location;
      return !!(
        location &&
        (location.latitude != null || location.city || location.state)
      );
    } catch (err: any) {
      // Thread exists but has no checkpoint yet (no runs executed), or server restarted
      this.logger.debug(
        `[${phoneNumber}] getState returned error (treating as no location): ${err?.message}`,
      );
      return false;
    }
  }

  /**
   * Send a human message on the user's thread and return the agent's reply.
   * Uses client.runs.wait() to block until the run completes, then extracts
   * the last AI message from the returned state.
   */
  async sendMessage(
    phoneNumber: string,
    content: string,
  ): Promise<SendMessageResult> {
    const threadId = await this.ensureThread(phoneNumber);

    let output: any;
    try {
      output = await this.client.runs.wait(
        threadId,
        this.assistantId,
        {
          input: { messages: [{ role: 'human', content }] },
          multitaskStrategy: 'reject', // Prevent concurrent runs on same thread
          metadata: this.buildRunMetadata(phoneNumber, 'user_message', {
            threadId,
            messageType: 'text_or_transcript',
          }),
        },
      );
    } catch (err: any) {
      this.logger.error(
        `[${phoneNumber}] runs.wait threw an error: ${err?.message}`,
      );
      // Try to repair first, only nuke if repair fails
      output = await this.repairAndRetry(phoneNumber, content);
    }

    // Check if the output actually has an AI reply
    const messages: any[] = output?.messages ?? [];
    const hasAiReply = [...messages].reverse().some(
      (m) =>
        m.type === 'ai' &&
        ((typeof m.content === 'string' && m.content.trim()) ||
          (Array.isArray(m.content) &&
            m.content.some((b: any) => b?.type === 'text' && b.text?.trim()))),
    );

    if (!hasAiReply) {
      this.logger.warn(
        `[${phoneNumber}] No AI reply in output — resetting thread and retrying`,
      );
      output = await this.repairAndRetry(phoneNumber, content);
    }

    const reply = this.extractReply(output, phoneNumber);

    // Extract question_id directly from tool output (authoritative source)
    const reviewId = this.extractQuestionIdFromToolOutput(output);

    if (reviewId) {
      this.logger.log(
        `[${phoneNumber}] ⚡ Question ID from tool output: ${reviewId}`,
      );

      // Update reviewer system with thread ID (fire and forget).
      // Keep payload lightweight to avoid backend 500s from oversized body.
      this.updateReviewerThreadId(reviewId, threadId, phoneNumber).catch((err) => {
        this.logger.error(
          `[${phoneNumber}] Error updating thread ID for question ${reviewId}: ${err?.message}`,
        );
      });
    }

    return { reply, reviewId };
  }

  /**
   * Try to repair a corrupted thread before resorting to a full reset.
   *
   * Strategy:
   *  1. Read the thread state and check if the last message is an orphaned
   *     tool_use (AI message with tool_calls but no subsequent tool response).
   *  2. If so, patch the state with synthetic tool responses via
   *     client.threads.updateState() to make the history valid again.
   *  3. Retry the user's message on the repaired thread.
   *  4. If repair fails or the retry fails, fall back to full thread reset
   *     (delete thread and recreate).
   */
  private async repairAndRetry(
    phoneNumber: string,
    content: string,
  ): Promise<any> {
    const threadId = await this.ensureThread(phoneNumber);

    // ── Step 1: Attempt in-place repair ──────────────────────────────────
    try {
      const state = await this.client.threads.getState(threadId);
      const messages: any[] = (state?.values as any)?.messages ?? [];

      if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1];

        if (
          lastMsg.type === 'ai' &&
          Array.isArray(lastMsg.tool_calls) &&
          lastMsg.tool_calls.length > 0
        ) {
          this.logger.warn(
            `[${phoneNumber}] 🔧 Detected orphaned tool_use — patching with synthetic tool responses`,
          );

          // Build synthetic tool responses for each pending tool_call
          const syntheticToolMessages = lastMsg.tool_calls.map((tc: any) => ({
            role: 'tool',
            content:
              'Tool execution was interrupted due to a network error. Please inform the user that the service was temporarily unavailable and ask them to retry.',
            tool_call_id: tc.id,
            name: tc.name ?? 'unknown',
          }));

          // Patch the thread state with the synthetic tool responses
          await this.client.threads.updateState(threadId, {
            values: {
              messages: syntheticToolMessages,
            },
          });

          this.logger.log(
            `[${phoneNumber}] ✅ Thread repaired — retrying message`,
          );
        }
      }

      return await this.client.runs.wait(
        threadId,
        this.assistantId,
        {
          input: { messages: [{ role: 'human', content }] },
          multitaskStrategy: 'reject',
          metadata: this.buildRunMetadata(phoneNumber, 'retry_after_repair', {
            threadId,
          }),
        },
      );
    } catch (repairErr: any) {
      this.logger.warn(
        `[${phoneNumber}] 🔧 Repair attempt failed (${repairErr?.message}) — falling back to full thread reset`,
      );
    }

    return this.resetThreadAndRetry(phoneNumber, content);
  }

  /**
   * Delete a corrupted thread and retry the user's message on a fresh one.
   * Called as a last resort when in-place repair fails. Note: this loses
   * all conversation history for the user.
   */
  private async resetThreadAndRetry(
    phoneNumber: string,
    content: string,
  ): Promise<any> {
    this.logger.warn(
      `[${phoneNumber}] 🔄 Deleting corrupted thread and retrying...`,
    );

    await this.deleteThread(phoneNumber);
    const threadId = await this.ensureThread(phoneNumber);

    try {
      return await this.client.runs.wait(
        threadId,
        this.assistantId,
        {
          input: { messages: [{ role: 'human', content }] },
          metadata: this.buildRunMetadata(phoneNumber, 'retry_after_reset', {
            threadId,
          }),
        },
      );
    } catch (retryErr: any) {
      this.logger.error(
        `[${phoneNumber}] Retry also failed after thread reset: ${retryErr?.message}`,
      );
      return { messages: [] };
    }
  }

  /**
   * Delete a thread from the LangGraph server.
   * Uses the direct REST endpoint: DELETE {AEGRA_BASE_URL}/threads/{threadId}
   */
  async deleteThread(phoneNumber: string): Promise<void> {
    const threadId = this.getThreadId(phoneNumber);
    const apiUrl = process.env.AEGRA_BASE_URL ?? 'http://localhost:8123';
    const url = `${apiUrl}/threads/${threadId}`;

    try {
      const res = await fetch(url, { method: 'DELETE' });
      if (res.ok) {
        this.logger.log(
          `[${phoneNumber}] 🗑️ Thread deleted successfully`,
        );
      } else {
        this.logger.warn(
          `[${phoneNumber}] Thread delete returned status ${res.status}`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `[${phoneNumber}] Failed to delete thread: ${err?.message}`,
      );
    }
  }

  /**
   * Sets the location on the thread by running the graph with the location
   * injected directly into the input. This ensures a proper checkpoint exists
   * before we try to read state, avoiding 404s on empty threads.
   */
  async updateLocation(
    phoneNumber: string,
    latitude: number,
    longitude: number,
    address?: string,
  ): Promise<void> {
    const threadId = await this.ensureThread(phoneNumber);

    // Run the graph with the location passed as input so it creates a
    // checkpoint and the `location` field is populated in state.
    await this.client.runs.wait(
      threadId,
      this.assistantId,
      {
        input: {
          location: {
            latitude,
            longitude,
            address: address ?? null,
            city: null,
            state: null,
          },
        },
        metadata: this.buildRunMetadata(phoneNumber, 'location_update', {
          threadId,
          latitude,
          longitude,
        }),
      },
    );

    this.logger.log(
      `[${phoneNumber}] Location set via run: ${latitude},${longitude}`,
    );
  }

  /**
   * Append an AI message to the thread's state without running the graph.
   * Used when sending messages via the API endpoint (e.g. reviewer answers)
   * so that these messages also appear in the LangGraph thread history.
   *
   * Uses POST /threads/{thread_id}/state with as_node to attribute
   * the message to the agent node.
   *
   * @param options.threadId — when set, writes to that thread (e.g. the day
   *   the question was asked); otherwise uses today's thread for the phone.
   */
  async appendAiMessage(
    phoneNumber: string,
    messageText: string,
    options?: { threadId?: string },
  ): Promise<void> {
    const threadId =
      typeof options?.threadId === 'string' && options.threadId.trim()
        ? options.threadId.trim()
        : await this.ensureThread(phoneNumber);

    try {
      await this.client.threads.updateState(threadId, {
        values: {
          messages: [
            {
              role: 'assistant',
              content: messageText,
            },
          ],
        },
        asNode: 'api_reviewer_message',
      });

      this.logger.log(
        `[${phoneNumber}] ✅ AI message appended to thread state`,
      );
    } catch (err: any) {
      this.logger.error(
        `[${phoneNumber}] Failed to append AI message to thread: ${err?.message}`,
      );
    }
  }

  /**
   * Append a user reaction event (thumbs up/down) into thread history.
   * This allows downstream analytics and memory tooling to inspect feedback.
   */
  async appendUserReaction(
    phoneNumber: string,
    reactedMessageId: string,
    emoji: '👍' | '👎',
  ): Promise<void> {
    const threadId = await this.ensureThread(phoneNumber);
    const feedbackEvent = {
      type: 'user_reaction',
      emoji,
      reactedMessageId,
      phoneNumber,
      userId: phoneNumber,
      channel: 'whatsapp',
      createdAt: new Date().toISOString(),
    };

    try {
      await this.client.threads.updateState(threadId, {
        values: {
          messages: [
            {
              role: 'human',
              content: JSON.stringify(feedbackEvent),
            },
          ],
        },
        asNode: 'user_feedback',
      });

      this.logger.log(
        `[${phoneNumber}] ✅ Reaction captured (${emoji}) for message ${reactedMessageId}`,
      );
    } catch (err: any) {
      this.logger.error(
        `[${phoneNumber}] Failed to append reaction to thread: ${err?.message}`,
      );
    }
  }

  /**
   * Extract the last AI text content from the final run output.
   * client.runs.wait() returns the graph's output state directly.
   */
  private messagesFromRunOutput(output: any): any[] {
    const top = output?.messages;
    if (Array.isArray(top) && top.length > 0) return top;
    const nested = output?.values?.messages;
    if (Array.isArray(nested)) return nested;
    return Array.isArray(top) ? top : [];
  }

  /** Summary runs may return messages under values or omit ai-shaped messages. */
  private extractSummaryText(output: any): string | undefined {
    const messages = this.messagesFromRunOutput(output);
    const lastAi = [...messages].reverse().find((m) => m.type === 'ai');
    if (lastAi) {
      if (typeof lastAi.content === 'string' && lastAi.content.trim()) {
        return lastAi.content.trim();
      }
      if (Array.isArray(lastAi.content)) {
        const text = lastAi.content
          .filter((b: any) => b?.type === 'text')
          .map((b: any) => String(b.text ?? ''))
          .join('');
        if (text.trim()) return text.trim();
      }
    }
    const summaryField = output?.summary ?? output?.values?.summary;
    if (typeof summaryField === 'string' && summaryField.trim()) {
      return summaryField.trim();
    }
    return undefined;
  }

  private extractReply(output: any, phoneNumber: string): string {
    const messages: any[] = this.messagesFromRunOutput(output);
    this.logger.debug(messages);
    const lastAi = [...messages].reverse().find((m) => m.type === 'ai');

    if (!lastAi) {
      this.logger.warn(`[${phoneNumber}] No AI message found in run output`);
      return 'I could not process your request right now. Please try again.';
    }

    if (typeof lastAi.content === 'string' && lastAi.content.trim()) {
      return lastAi.content.trim();
    }

    if (Array.isArray(lastAi.content)) {
      const text = lastAi.content
        .filter((b: any) => b?.type === 'text')
        .map((b: any) => String(b.text ?? ''))
        .join('');
      if (text.trim()) return text.trim();
    }

    this.logger.warn(`[${phoneNumber}] AI message had no extractable text`);
    return 'I could not process your request right now. Please try again.';
  }

  /**
   * Extract question_id from the 'upload_question_to_reviewer_system' tool
   * output message. Looks in artifact.structured_content first, then falls
   * back to parsing the text content JSON.
   *
   * IMPORTANT: `client.runs.wait()` returns the FULL thread message history,
   * not just the messages produced by the current run. We must therefore
   * restrict our search to tool messages emitted AFTER the latest human
   * message — i.e. the one we just sent in this call. Otherwise a follow-up
   * question that does NOT trigger the reviewer tool would incorrectly inherit
   * the question_id from an earlier message in the same thread, causing
   * duplicate pending_questions rows with the same questionId in Mongo.
   */
  private extractQuestionIdFromToolOutput(output: any): string | undefined {
    const messages: any[] = this.messagesFromRunOutput(output);

    let lastHumanIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.type === 'human') {
        lastHumanIdx = i;
        break;
      }
    }

    const currentRunMessages =
      lastHumanIdx >= 0 ? messages.slice(lastHumanIdx + 1) : messages;

    const toolMsg = [...currentRunMessages].reverse().find(
      (m: any) =>
        m.type === 'tool' &&
        m.name === 'upload_question_to_reviewer_system',
    );

    if (!toolMsg) return undefined;

    // Primary: artifact.structured_content.result.data.question_id
    const fromArtifact =
      toolMsg?.artifact?.structured_content?.result?.data?.question_id;
    if (fromArtifact) return fromArtifact;

    // Fallback: parse the text content JSON
    try {
      const contentBlocks = Array.isArray(toolMsg.content)
        ? toolMsg.content
        : [toolMsg.content];

      for (const block of contentBlocks) {
        const text = typeof block === 'string' ? block : block?.text;
        if (!text) continue;

        const parsed = JSON.parse(text);
        if (parsed?.data?.question_id) return parsed.data.question_id;
      }
    } catch {
      // Ignore JSON parse errors
    }

    return undefined;
  }

  private async updateReviewerThreadId(
    reviewId: string,
    threadId: string,
    phoneNumber: string,
  ): Promise<void> {
    const url = `https://desk.vicharanashala.ai/api/questions/${reviewId}`;
    const headers = { 'Content-Type': 'application/json' };

    // Primary payload
    let res = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ threadId }),
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.warn(
        `[${phoneNumber}] Reviewer update failed (threadId) for ${reviewId}. Status=${res.status}, body=${body}`,
      );

      // Compatibility retry for backends expecting snake_case.
      res = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ thread_id: threadId }),
      });

      if (!res.ok) {
        const retryBody = await res.text();
        this.logger.warn(
          `[${phoneNumber}] Reviewer update failed (thread_id) for ${reviewId}. Status=${res.status}, body=${retryBody}`,
        );
        return;
      }
    }

    this.logger.log(
      `[${phoneNumber}] Successfully updated thread ID for question ${reviewId}`,
    );
  }
}
