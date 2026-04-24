import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AegraService {
  private readonly logger = new Logger(AegraService.name);
  private readonly baseUrl: string;
  private readonly assistantId: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('AEGRA_BASE_URL')!;
    this.assistantId = this.configService.get<string>('AEGRA_ASSISTANT_ID')!;
  }

  /**
   * Creates a new thread on the Aegra Server.
   * @param phoneNumber The phone number to use as thread_id.
   * @returns The generated thread_id.
   */
  async createThread(phoneNumber: string): Promise<string> {
    try {
      this.logger.log(`Creating new thread on Aegra server for ${phoneNumber}...`);
      const response = await fetch(`${this.baseUrl}/threads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ thread_id: phoneNumber }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create thread: ${response.statusText}`);
      }

      const data = await response.json();
      return data.thread_id;
    } catch (error: any) {
      this.logger.error(`Error creating thread: ${error.message}`);
      throw error;
    }
  }

  /**
   * Sends a message to a specific thread and waits for the AI response.
   * @param threadId The ID of the thread.
   * @param messageContent The content of the user's message.
   * @returns The AI's reply string.
   */
  async sendMessageAndWait(
    threadId: string,
    messageContent: string,
  ): Promise<string> {
    try {
      this.logger.log(`Sending message to thread ${threadId}...`);
      const response = await fetch(`${this.baseUrl}/threads/${threadId}/runs/wait`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          assistant_id: this.assistantId,
          input: {
            messages: [
              {
                role: 'user',
                content: messageContent,
              },
            ],
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Extract the last AI message from the response
      const messages = data.messages || [];
      const lastAiMessage = [...messages].reverse().find((msg) => msg.role === 'ai' || msg.type === 'ai');

      if (!lastAiMessage) {
        this.logger.warn('No AI message found in response.');
        return 'I am sorry, I could not generate a response right now.';
      }

      return lastAiMessage.content;
    } catch (error: any) {
      this.logger.error(`Error sending message and waiting: ${error.message}`);
      throw error;
    }
  }
}
