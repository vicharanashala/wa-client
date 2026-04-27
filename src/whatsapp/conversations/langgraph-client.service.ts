import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from '@langchain/langgraph-sdk';

export interface SendMessageResult {
  reply: string;
}

/**
 * Thin wrapper around the LangGraph SDK Client.
 *
 * Design decisions:
 * - One thread per phone number; thread_id === phone number.
 * - Threads are created idempotently (`if_exists: "do_nothing"`).
 * - Messages are sent as streaming runs; we collect the last AI message.
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
   *
   * @param phoneNumber - Used as thread_id.
   * @param content     - The human message text to send.
   */
  async sendMessage(
    phoneNumber: string,
    content: string,
  ): Promise<SendMessageResult> {
    const threadId = await this.ensureThread(phoneNumber);

    const messages = [{ role: 'human', content }];

    const streamResponse = this.client.runs.stream(
      threadId,
      this.assistantId,
      {
        input: { messages },
        streamMode: 'messages',
      },
    );



    return this.collectReply(streamResponse, phoneNumber);
  }

  /**
   * Send a location update as a human message on the user's thread.
   * Formats the location into the message the agent can understand.
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
   * Collect the last AI text from a streaming run response.
   */
  private async collectReply(
    streamResponse: AsyncIterable<any>,
    phoneNumber: string,
  ): Promise<SendMessageResult> {
    let reply = '';

    try {
      for await (const chunk of streamResponse) {
        if (chunk.event === 'messages/partial' || chunk.event === 'messages/complete') {
          const data = chunk.data;
          if (Array.isArray(data)) {
            for (const msg of data) {
              if (
                msg.type === 'ai' &&
                typeof msg.content === 'string' &&
                msg.content.trim()
              ) {
                reply = msg.content.trim();
              } else if (
                msg.type === 'ai' &&
                Array.isArray(msg.content)
              ) {
                const text = msg.content
                  .filter((b: any) => b?.type === 'text')
                  .map((b: any) => String(b.text ?? ''))
                  .join('');
                if (text.trim()) reply = text.trim();
              }
            }
          }
        }

        // values event carries the full state — use messages array as fallback
        if (chunk.event === 'values' && chunk.data?.messages) {
          const msgs: any[] = chunk.data.messages;
          const lastAi = [...msgs].reverse().find((m) => m.type === 'ai');
          if (lastAi) {
            if (typeof lastAi.content === 'string' && lastAi.content.trim()) {
              reply = lastAi.content.trim();
            } else if (Array.isArray(lastAi.content)) {
              const text = lastAi.content
                .filter((b: any) => b?.type === 'text')
                .map((b: any) => String(b.text ?? ''))
                .join('');
              if (text.trim()) reply = text.trim();
            }
          }
        }
      }
    } catch (err: any) {
      this.logger.error(
        `[${phoneNumber}] Stream error: ${err?.message ?? String(err)}`,
      );
    }

    if (!reply) {
      this.logger.warn(`[${phoneNumber}] No AI reply extracted from stream`);
      reply = 'I could not process your request right now. Please try again.';
    }

    return { reply };
  }
}
