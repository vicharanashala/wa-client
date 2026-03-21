import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis;

  private static readonly CACHE_TTL = 86400; // 24 hours
  private static readonly KEY_PREFIX = 'wa:context:';
  private static readonly MAX_MESSAGES = 10;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URI || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000), // Backoff
    });

    this.redis.on('connect', () => this.logger.log('Connected to Redis'));
    this.redis.on('error', (err) => this.logger.error('Redis error:', err));
  }

  private getKey(phoneNumber: string): string {
    return `${CacheService.KEY_PREFIX}${phoneNumber}`;
  }

  /** Gets context from Redis, returning null if empty/missing */
  async getConversationHistory(phoneNumber: string): Promise<ChatCompletionMessageParam[] | null> {
    try {
      const data = await this.redis.get(this.getKey(phoneNumber));
      if (!data) return null;

      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : null;
    } catch (error) {
      this.logger.error(`Failed to fetch cache for ${phoneNumber}:`, error);
      return null;
    }
  }

  /** Replaces the entire context in Redis */
  async setConversationHistory(
    phoneNumber: string,
    messages: ChatCompletionMessageParam[],
  ): Promise<void> {
    try {
      await this.redis.setex(
        this.getKey(phoneNumber),
        CacheService.CACHE_TTL,
        JSON.stringify(messages),
      );
    } catch (error) {
      this.logger.error(`Failed to set cache for ${phoneNumber}:`, error);
    }
  }

  /** Atomically fetches the old list, appends new msgs, trims logic, and sets it back */
  async appendMessages(
    phoneNumber: string,
    userMsg: string,
    botReply: string,
  ): Promise<void> {
    try {
      const existing = (await this.getConversationHistory(phoneNumber)) || [];
      
      existing.push({ role: 'user', content: userMsg });
      existing.push({ role: 'assistant', content: botReply });

      // Trim if it exceeds max
      if (existing.length > CacheService.MAX_MESSAGES) {
        existing.splice(0, existing.length - CacheService.MAX_MESSAGES);
      }

      await this.setConversationHistory(phoneNumber, existing);
    } catch (error) {
      this.logger.error(`Failed to append cache for ${phoneNumber}:`, error);
    }
  }

  async clearConversation(phoneNumber: string): Promise<void> {
    try {
      await this.redis.del(this.getKey(phoneNumber));
    } catch (error) {
      this.logger.error(`Failed to clear cache for ${phoneNumber}:`, error);
    }
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
