import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WhitelistModel, WhitelistDocument } from './whitelist.schema';
import { BlacklistModel, BlacklistDocument } from './blacklist.schema';

@Injectable()
export class AccessControlService implements OnModuleInit {
  private readonly logger = new Logger(AccessControlService.name);

  constructor(
    @InjectModel(WhitelistModel.name)
    private readonly whitelistModel: Model<WhitelistDocument>,
    @InjectModel(BlacklistModel.name)
    private readonly blacklistModel: Model<BlacklistDocument>,
  ) {}

  /**
   * On startup, log access control status.
   * Whitelist/blacklist entries are managed directly via MongoDB.
   */
  async onModuleInit(): Promise<void> {
    const whitelistCount = await this.whitelistModel.countDocuments().exec();
    const blacklistCount = await this.blacklistModel.countDocuments().exec();
    const isProduction = this.isProductionMode();

    this.logger.log(
      `🔐 Access Control initialized | mode=${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'} | whitelist=${whitelistCount} | blacklist=${blacklistCount}`,
    );
  }

  /**
   * Check if the given phone number is allowed to interact with the bot.
   *
   * Production mode (IS_PRODUCTION=true):
   *   → Allow ALL numbers EXCEPT blacklisted ones.
   *
   * Development mode (IS_PRODUCTION=false):
   *   → Allow ONLY whitelisted numbers.
   */
  async isNumberAllowed(phoneNumber: string): Promise<boolean> {
    const isProduction = this.isProductionMode();

    if (isProduction) {
      // Production: block only blacklisted numbers
      const blacklisted = await this.blacklistModel
        .findOne({ phoneNumber, isActive: true })
        .lean()
        .exec();

      if (blacklisted) {
        this.logger.warn(
          `🚫 Blocked blacklisted number: ${phoneNumber} (${blacklisted.name})`,
        );
        return false;
      }
      return true;
    } else {
      // Development: allow only whitelisted numbers
      const whitelisted = await this.whitelistModel
        .findOne({ phoneNumber, isActive: true })
        .lean()
        .exec();

      if (!whitelisted) {
        this.logger.warn(
          `🚫 Blocked non-whitelisted number in dev mode: ${phoneNumber}`,
        );
        return false;
      }
      return true;
    }
  }

  private isProductionMode(): boolean {
    // Default to false if IS_PRODUCTION is not set in env
    const val = process.env.IS_PRODUCTION || 'false';
    return val === 'true' || val === '1';
  }
}
