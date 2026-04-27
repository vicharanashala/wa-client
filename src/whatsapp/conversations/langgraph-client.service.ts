import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client} from '@langchain/langgraph-sdk';
export interface SendMessageResult {
  reply: string;
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
    const apiUrl = process.env.LANGGRAPH_BASE_URL;
    this.assistantId = process.env.LANGGRAPH_ASSISTANT_ID ?? '';

    if (!this.assistantId) {
      this.logger.error(
        'LANGGRAPH_ASSISTANT_ID env var is not set. Conversation routing will fail.',
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

    return { reply: this.extractReply(output, phoneNumber) };
  }

  /**
   * Send a location update as a human message on the user's thread.
   */
  async sendLocation(
    phoneNumber: string,
    latitude: number,
    longitude: number,
    address?: string,
  ): Promise<SendMessageResult> {
    const locationText = `My location: latitude ${latitude}, longitude ${longitude}${address ? `, address: ${address}` : ''}.`;
    return this.sendMessage(phoneNumber, locationText);
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
}
