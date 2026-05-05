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
  private client: Client;
  private assistantId: string;

  onModuleInit(): void {
    const apiUrl = process.env.AEGRA_BASE_URL;
    this.assistantId = process.env.AEGRA_ASSISTANT_ID ?? '';

    if (!this.assistantId) {
      this.logger.error(
        'AEGRA_ASSISTANT_ID env var is not set. Conversation routing will fail.',
      );
    }

    this.client = new Client({ apiUrl });

    this.logger.log(
      `LangGraph client initialised — baseUrl=${apiUrl ?? 'http://localhost:8123 (default)'}, assistantId=${this.assistantId}`,
    );
  }

  /**
   * Ensure a persistent thread exists for the given phone number.
   * Uses the phone number as the thread ID so there is always exactly
   * one thread per user.
   */
  async ensureThread(phoneNumber: string): Promise<string> {
    await this.client.threads.create({
      thread_id: phoneNumber,
      if_exists: 'do_nothing',
    } as any);
    return phoneNumber;
  }

  /**
   * Returns true if the thread's state already has a location set.
   * Reads the `location` field from AjraSakhaState directly.
   * Returns false if the thread doesn't exist yet or has no state.
   */
  async hasLocation(phoneNumber: string): Promise<boolean> {
    await this.ensureThread(phoneNumber);
    try {
      const state = await this.client.threads.getState(phoneNumber);
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

      // Update reviewer system with user phone number (fire and forget)
      fetch(`https://desk.vicharanashala.ai/api/questions/${reviewId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phoneNumber }),
      })
        .then((res) => {
          if (!res.ok) {
            this.logger.warn(
              `[${phoneNumber}] Failed to update phone number for question ${reviewId}. Status: ${res.status}`,
            );
          } else {
            this.logger.log(
              `[${phoneNumber}] Successfully updated phone number for question ${reviewId}`,
            );
          }
        })
        .catch((err) => {
          this.logger.error(
            `[${phoneNumber}] Error updating phone number for question ${reviewId}: ${err?.message}`,
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
    // ── Step 1: Attempt in-place repair ──────────────────────────────────
    try {
      const state = await this.client.threads.getState(phoneNumber);
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
          await this.client.threads.updateState(phoneNumber, {
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
        phoneNumber,
        this.assistantId,
        {
          input: { messages: [{ role: 'human', content }] },
          multitaskStrategy: 'reject',
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
    await this.ensureThread(phoneNumber);

    try {
      return await this.client.runs.wait(
        phoneNumber,
        this.assistantId,
        {
          input: { messages: [{ role: 'human', content }] },
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
    const apiUrl = process.env.AEGRA_BASE_URL ?? 'http://localhost:8123';
    const url = `${apiUrl}/threads/${phoneNumber}`;

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
    await this.ensureThread(phoneNumber);

    // Run the graph with the location passed as input so it creates a
    // checkpoint and the `location` field is populated in state.
    await this.client.runs.wait(
      phoneNumber,
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
      },
    );

    this.logger.log(
      `[${phoneNumber}] Location set via run: ${latitude},${longitude}`,
    );
  }

  /**
   * Extract the last AI text content from the final run output.
   * client.runs.wait() returns the graph's output state directly.
   */
  private extractReply(output: any, phoneNumber: string): string {
    const messages: any[] = output?.messages ?? [];
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
   */
  private extractQuestionIdFromToolOutput(output: any): string | undefined {
    const messages: any[] = output?.messages ?? [];

    const toolMsg = messages.find(
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
}
