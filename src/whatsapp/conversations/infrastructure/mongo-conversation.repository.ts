import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Conversation } from '../domain/conversation';
import { ConversationRepository } from './conversation.repository';
import { ConversationDocument, ConversationModel } from './conversation.schema';

@Injectable()
export class MongoConversationRepository implements ConversationRepository {
  constructor(
    @InjectModel(ConversationModel.name)
    private readonly model: Model<ConversationDocument>,
  ) {}

  async findByPhone(phoneNumber: string): Promise<Conversation | null> {
    const doc = await this.model.findOne({ phoneNumber }).exec();
    if (!doc) return null;
    return Conversation.reconstitute(
      doc.phoneNumber,
      doc.messages,
      doc.location ?? undefined,
      doc.preferredLanguage ?? undefined,
      doc.userDetailsSummary ?? undefined,
    );
  }

  async save(conversation: Conversation): Promise<void> {
    await this.model
      .findOneAndUpdate(
        { phoneNumber: conversation.phoneNumber },
        {
          $set: {
            messages: conversation.messages,
            ...(conversation.location && { location: conversation.location }),
            ...(conversation.preferredLanguage && {
              preferredLanguage: conversation.preferredLanguage,
            }),
            ...(conversation.userDetailsSummary && {
              userDetailsSummary: conversation.userDetailsSummary,
            }),
          },
        },
        { upsert: true, returnDocument: 'after' },
      )
      .exec();
  }

  async delete(phoneNumber: string): Promise<boolean> {
    const result = await this.model.deleteOne({ phoneNumber }).exec();
    return result.deletedCount > 0;
  }
}
