import { Injectable, Logger } from '@nestjs/common';

interface CachedMessage {
  phoneNumber: string;
  fullMessage: string;
  createdAt: number;
}

/**
 * Simple in-memory cache for storing full messages that need to be retrieved
 * when users click "Show More" buttons. Messages expire after 30 minutes.
 */
@Injectable()
export class MessageCacheService {
  private readonly logger = new Logger(MessageCacheService.name);
  private readonly cache = new Map<string, CachedMessage>();
  private readonly TTL_MS = 30 * 60 * 1000; // 30 minutes
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Store a full message and return a unique ID for retrieval.
   * @param phoneNumber The recipient's phone number
   * @param fullMessage The complete message text
   * @returns A unique message ID (e.g., "msg_12345")
   */
  store(phoneNumber: string, fullMessage: string): string {
    const messageId = this.generateMessageId();
    const cachedMessage: CachedMessage = {
      phoneNumber,
      fullMessage,
      createdAt: Date.now(),
    };
    this.cache.set(messageId, cachedMessage);
    this.logger.debug(
      `Cached message ${messageId} for ${phoneNumber} (${fullMessage.length} chars)`,
    );
    return messageId;
  }

  /**
   * Retrieve a cached message by its ID.
   * @param messageId The unique message ID
   * @returns The cached message data or null if not found/expired
   */
  retrieve(messageId: string): CachedMessage | null {
    const cached = this.cache.get(messageId);
    if (!cached) {
      this.logger.debug(`Cache miss for message ID: ${messageId}`);
      return null;
    }

    // Check if expired
    if (Date.now() - cached.createdAt > this.TTL_MS) {
      this.logger.debug(`Message ${messageId} has expired`);
      this.cache.delete(messageId);
      return null;
    }

    return cached;
  }

  /**
   * Remove a message from the cache after it's been retrieved.
   * @param messageId The unique message ID to delete
   */
  delete(messageId: string): void {
    this.cache.delete(messageId);
  }

  /**
   * Generate a unique message ID.
   * Format: msg_<timestamp>_<random>
   */
  private generateMessageId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `msg_${timestamp}_${random}`;
  }

  /**
   * Clean up expired messages from the cache.
   */
  private cleanup(): void {
    const now = Date.now();
    let expiredCount = 0;

    for (const [messageId, cached] of this.cache.entries()) {
      if (now - cached.createdAt > this.TTL_MS) {
        this.cache.delete(messageId);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      this.logger.debug(`Cleaned up ${expiredCount} expired cached messages`);
    }
  }

  /**
   * Get the current number of cached messages (for debugging).
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Destroy the service (call on app shutdown).
   */
  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
  }
}