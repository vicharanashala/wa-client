import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  WhatsappUserDocument,
  WhatsappUserModel,
} from './whatsapp-user.schema';
import {
  FindUsersParams,
  FindUsersResult,
  WhatsappUserListItem,
  WhatsappUserRepository,
} from './whatsapp-user.repository';

const DEFAULT_SKIP = 0;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Injectable()
export class MongoWhatsappUserRepository implements WhatsappUserRepository {
  constructor(
    @InjectModel(WhatsappUserModel.name)
    private readonly model: Model<WhatsappUserDocument>,
  ) {}

  async recordMessage(
    phoneNumber: string,
    messageText: string,
  ): Promise<void> {
    const now = new Date();
    await this.model
      .findOneAndUpdate(
        { phoneNumber },
        {
          $inc: { messageCount: 1 },
          $set: { lastMessageAt: now, lastMessageText: messageText },
          $setOnInsert: {
            firstMessageAt: now,
            firstMessageText: messageText,
          },
        },
        { upsert: true },
      )
      .exec();
  }

  async findAll(params: FindUsersParams): Promise<FindUsersResult> {
    const total = await this.model.countDocuments().exec();
    const sort = { lastMessageAt: -1 as const };

    if (!params.isPaginated) {
      const rows = await this.model.find().sort(sort).lean().exec();
      return {
        data: rows.map((row) => this.toListItem(row)),
        total,
        skip: 0,
        limit: total,
        isPaginated: false,
      };
    }

    const skip = params.skip ?? DEFAULT_SKIP;
    const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const rows = await this.model
      .find()
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    return {
      data: rows.map((row) => this.toListItem(row)),
      total,
      skip,
      limit,
      isPaginated: true,
    };
  }

  private toListItem(row: WhatsappUserModel): WhatsappUserListItem {
    return {
      phoneNumber: row.phoneNumber,
      messageCount: row.messageCount,
      firstMessageAt: row.firstMessageAt,
      lastMessageAt: row.lastMessageAt,
      firstMessageText: row.firstMessageText ?? null,
      lastMessageText: row.lastMessageText,
    };
  }

  async countUniqueUsers(): Promise<number> {
    return this.model.countDocuments().exec();
  }
}
