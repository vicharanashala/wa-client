import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  UserDetailsModel,
  UserDetailsDocument,
} from './user-details.schema';
import { UserDetailsRepository } from './user-details.repository';

@Injectable()
export class MongoUserDetailsRepository implements UserDetailsRepository {
  private readonly logger = new Logger(MongoUserDetailsRepository.name);

  constructor(
    @InjectModel(UserDetailsModel.name, 'USER_DETAILS_MONGO')
    private readonly userDetailsModel: Model<UserDetailsDocument>,
  ) {}

  async getLastRephrasedQuery(userId: string): Promise<string | null> {
    try {
      const userDetails = await this.userDetailsModel
        .findOne({ user_id: userId })
        .select('last_rephrased_query')
        .lean()
        .exec();

      if (!userDetails) {
        this.logger.debug(`[${userId}] No user_details found`);
        return null;
      }

      const query = userDetails.last_rephrased_query;
      this.logger.debug(
        `[${userId}] Found last_rephrased_query: ${query ? `"${query.slice(0, 50)}..."` : 'null'}`,
      );
      return query ?? null;
    } catch (err: any) {
      this.logger.error(
        `[${userId}] Failed to fetch user_details: ${err?.message}`,
      );
      return null;
    }
  }
}