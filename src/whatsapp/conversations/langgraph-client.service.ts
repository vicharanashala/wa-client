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

    const output = await this.client.runs.wait(
      threadId,
      this.assistantId,
      {
        input: { messages: [{ role: 'human', content }] },
      },
    );

    const rawReply = this.extractReply(output, phoneNumber);
    const { cleanReply, reviewId } = this.extractReviewId(rawReply);

    if (reviewId) {
      this.logger.log(
        `[${phoneNumber}] ⚡ REV_ID detected in response: ${reviewId}`,
      );
    }

    return { reply: cleanReply, reviewId };
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
   * Check if the reply's last line contains |||REV_ID:xxx|||.
   * If so, extract the ID and return a cleaned reply without that line.
   */
  private extractReviewId(reply: string): {
    cleanReply: string;
    reviewId?: string;
  } {
    const regex = /\|\|\|REV_ID:([a-f0-9]+)\|\|\|\s*$/;
    const match = reply.match(regex);

    if (match) {
      const reviewId = match[1];
      const cleanReply = reply.replace(regex, '').trim();
      return { cleanReply, reviewId };
    }

    return { cleanReply: reply };
  }
}
