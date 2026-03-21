import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { Conversation, ConversationDocument } from '../schemas/conversation.schema';

@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);
  private static readonly MAX_HISTORY_LENGTH = 10;

  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
  ) {}

  /**
   * Retrieves the most recent conversation history for a phone number.
   */
  async getConversationHistory(phoneNumber: string): Promise<ChatCompletionMessageParam[]> {
    try {
      const conversation = await this.conversationModel
        .findOne({ phoneNumber })
        .lean()
        .exec();

      if (!conversation || !conversation.messages) {
        return [];
      }

      // Return only the most recent N messages
      return conversation.messages.slice(-DatabaseService.MAX_HISTORY_LENGTH);
    } catch (error) {
      this.logger.error(`Error fetching DB history for ${phoneNumber}:`, error);
      return [];
    }
  }

  /**
   * Appends the new user and assistant messages to the array.
   * Also ensures the array doesn't exceed the MAX_HISTORY_LENGTH by $slicing.
   */
  async saveMessages(
    phoneNumber: string,
    userMessage: string,
    botReply: string,
  ): Promise<void> {
    try {
      await this.conversationModel.findOneAndUpdate(
        { phoneNumber },
        {
          $push: {
            messages: {
              $each: [
                { role: 'user', content: userMessage },
                { role: 'assistant', content: botReply },
              ],
              $slice: -DatabaseService.MAX_HISTORY_LENGTH,
            },
          },
          $set: { lastActivity: new Date() },
        },
        {
          upsert: true,
          new: true,
        },
      );
    } catch (error) {
      this.logger.error(`Failed to save DB messages for ${phoneNumber}:`, error);
      throw error;
    }
  }

  /**
   * Clears all messages from the conversation document.
   */
  async clearConversation(phoneNumber: string): Promise<void> {
    try {
      await this.conversationModel.findOneAndUpdate(
        { phoneNumber },
        {
          $set: { messages: [], lastActivity: new Date() },
        },
        { upsert: true },
      );
    } catch (error) {
      this.logger.error(`Failed to clear DB conversation for ${phoneNumber}:`, error);
      throw error;
    }
  }
}
