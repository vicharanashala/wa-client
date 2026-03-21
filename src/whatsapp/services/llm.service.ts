import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { Result, Ok, Err } from 'oxide.ts';

import { CacheService } from './cache.service';
import { DatabaseService } from './database.service';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: OpenAI;

  constructor(
    private readonly cache: CacheService,
    private readonly db: DatabaseService,
  ) {
    this.client = new OpenAI({
      baseURL: process.env.LLM_BASE_URL || 'http://localhost:8000/v1',
      apiKey: process.env.LLM_API_KEY || 'dummy-key',
      timeout: 30_000,
    });
  }

  async generateResponse(
    phoneNumber: string,
    messageText: string,
  ): Promise<Result<string, Error>> {
    try {
      // 1. Fetch History Architecture: Try Redis first
      let history = await this.cache.getConversationHistory(phoneNumber);

      // 2. Cache Miss? Fallback to MongoDB
      if (!history) {
        this.logger.debug(`Cache miss for ${phoneNumber}. Fetching from DB.`);
        history = await this.db.getConversationHistory(phoneNumber);
        
        // Warm up cache for the future
        if (history.length > 0) {
          await this.cache.setConversationHistory(phoneNumber, history);
        }
      } else {
        this.logger.debug(`Cache hit for ${phoneNumber} (${history.length} msgs)`);
      }

      // 3. Prepare full payload
      const messages: ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: process.env.SYSTEM_PROMPT || 
            'You are a helpful WhatsApp assistant. Keep responses concise and conversational.',
        },
        ...history,
        { role: 'user', content: messageText },
      ];

      // 4. Call LLM
      const completion = await this.client.chat.completions.create({
        model: process.env.LLM_MODEL || 'gpt-3.5-turbo',
        messages,
        max_tokens: parseInt(process.env.MAX_TOKENS || '500', 10),
        temperature: parseFloat(process.env.TEMPERATURE || '0.7'),
      });

      const reply = completion.choices?.[0]?.message?.content?.trim();
      if (!reply) return Err(new Error('Empty LLM response'));

      // 5. Fire-and-forget Write-Back: update BOTH Cache and Database
      Promise.all([
        this.cache.appendMessages(phoneNumber, messageText, reply),
        this.db.saveMessages(phoneNumber, messageText, reply),
      ]).catch(err => {
        this.logger.error(`Async save failed for ${phoneNumber}:`, err);
      });

      return Ok(reply);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`LLM Error for ${phoneNumber}:`, err);
      return Err(err);
    }
  }

  async clearConversation(phoneNumber: string): Promise<void> {
    await Promise.all([
      this.cache.clearConversation(phoneNumber),
      this.db.clearConversation(phoneNumber),
    ]);
  }
}