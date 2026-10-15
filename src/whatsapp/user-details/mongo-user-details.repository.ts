import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Result, Ok, Err } from 'oxide.ts';
import {
  UserDetailsModel,
  UserDetailsDocument,
  LocationProfile,
} from './user-details.schema';
import {
  UserDetailsRepository,
  RepositoryError,
  RepositoryErrorCode,
  FarmerProfile,
  UserCheckResult,
  RegistrationStats,
} from './user-details.repository';

// ─────────────────────────────────────────────────────────────
// Repository Implementation
// ─────────────────────────────────────────────────────────────

@Injectable()
export class MongoUserDetailsRepository implements UserDetailsRepository {
  private readonly logger = new Logger(MongoUserDetailsRepository.name);

  constructor(
    @InjectModel(UserDetailsModel.name, 'USER_DETAILS_MONGO')
    private readonly userDetailsModel: Model<UserDetailsDocument>,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // Existing Method
  // ─────────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────
  // New Methods
  // ─────────────────────────────────────────────────────────────

  async checkUserStatus(userId: string): Promise<Result<UserCheckResult, RepositoryError>> {
    try {
      const normalizedId = this.normalizePhoneNumber(userId);

      const doc = await this.userDetailsModel
        .findOne({ user_id: normalizedId })
        .lean()
        .exec();

      if (!doc) {
        return Ok({
          exists: false,
          profile: null,
          shouldStartRegistration: true,
          shouldResumeRegistration: false,
        });
      }

      const profile = this.mapToProfile(doc);

      return Ok({
        exists: true,
        profile,
        shouldStartRegistration: false,
        shouldResumeRegistration: doc.isRegistrationInProgress && !doc.isProfileComplete,
      });

    } catch (error) {
      this.logger.error(`[${userId}] Error checking user status: ${error}`);
      return Err(this.mapError(error));
    }
  }

  async createUser(userId: string): Promise<Result<void, RepositoryError>> {
    try {
      const normalizedId = this.normalizePhoneNumber(userId);

      await this.userDetailsModel.create({
        user_id: normalizedId,
        isProfileComplete: false,
        isRegistrationInProgress: false,
      });

      this.logger.log(`Created user document for ${normalizedId}`);
      return Ok(undefined);

    } catch (error: any) {
      // Handle duplicate key error (idempotent)
      if (error.code === 11000) {
        this.logger.debug(`User ${userId} already exists`);
        return Ok(undefined);
      }
      this.logger.error(`[${userId}] Error creating user: ${error}`);
      return Err(this.mapError(error));
    }
  }

  async updateName(userId: string, name: string): Promise<Result<void, RepositoryError>> {
    try {
      const normalizedId = this.normalizePhoneNumber(userId);

      const result = await this.userDetailsModel.updateOne(
        { user_id: normalizedId },
        { $set: { name: name.trim(), isRegistrationInProgress: true } },
      );

      if (result.matchedCount === 0) {
        return Err(new RepositoryError('User not found', RepositoryErrorCode.NOT_FOUND));
      }

      this.logger.debug(`Updated name for ${normalizedId}`);
      return Ok(undefined);

    } catch (error) {
      this.logger.error(`[${userId}] Error updating name: ${error}`);
      return Err(this.mapError(error));
    }
  }

  async updateLocationProfile(userId: string, profile: LocationProfile): Promise<Result<void, RepositoryError>> {
    try {
      const normalizedId = this.normalizePhoneNumber(userId);

      const result = await this.userDetailsModel.updateOne(
        { user_id: normalizedId },
        { $set: { profile, isRegistrationInProgress: true } },
      );

      if (result.matchedCount === 0) {
        return Err(new RepositoryError('User not found', RepositoryErrorCode.NOT_FOUND));
      }

      this.logger.debug(`Updated location profile for ${normalizedId}`);
      return Ok(undefined);

    } catch (error) {
      this.logger.error(`[${userId}] Error updating profile: ${error}`);
      return Err(this.mapError(error));
    }
  }

  async completeRegistration(userId: string): Promise<Result<void, RepositoryError>> {
    try {
      const normalizedId = this.normalizePhoneNumber(userId);
      const now = new Date();

      const result = await this.userDetailsModel.updateOne(
        { user_id: normalizedId },
        {
          $set: {
            isProfileComplete: true,
            isRegistrationInProgress: false,
            'registrationStep.currentStep': 5,
            'registrationStep.stepName': 'complete',
            'registrationStep.lastUpdatedAt': now,
            current_location: { state: '', district: '' },
          },
        },
      );

      if (result.matchedCount === 0) {
        return Err(new RepositoryError('User not found', RepositoryErrorCode.NOT_FOUND));
      }

      this.logger.log(`Registration completed for ${normalizedId}`);
      return Ok(undefined);

    } catch (error) {
      this.logger.error(`[${userId}] Error completing registration: ${error}`);
      return Err(this.mapError(error));
    }
  }

  async cancelRegistration(userId: string): Promise<Result<void, RepositoryError>> {
    try {
      const normalizedId = this.normalizePhoneNumber(userId);

      await this.userDetailsModel.updateOne(
        { user_id: normalizedId },
        { $set: { isRegistrationInProgress: false, registrationStep: null } },
      );

      this.logger.debug(`Cancelled registration for ${normalizedId}`);
      return Ok(undefined);

    } catch (error) {
      this.logger.error(`[${userId}] Error cancelling registration: ${error}`);
      return Err(this.mapError(error));
    }
  }

  async getProfile(userId: string): Promise<Result<FarmerProfile | null, RepositoryError>> {
    try {
      const normalizedId = this.normalizePhoneNumber(userId);

      const doc = await this.userDetailsModel
        .findOne({ user_id: normalizedId })
        .lean()
        .exec();

      if (!doc) {
        return Ok(null);
      }

      return Ok(this.mapToProfile(doc));

    } catch (error) {
      this.logger.error(`[${userId}] Error getting profile: ${error}`);
      return Err(this.mapError(error));
    }
  }

  async getStats(): Promise<Result<RegistrationStats, RepositoryError>> {
    try {
      const [totalUsers, completed, inProgress] = await Promise.all([
        this.userDetailsModel.countDocuments().lean().exec(),
        this.userDetailsModel.countDocuments({ isProfileComplete: true }).lean().exec(),
        this.userDetailsModel.countDocuments({ isRegistrationInProgress: true }).lean().exec(),
      ]);

      return Ok({
        totalUsers,
        completedRegistrations: completed,
        inProgressRegistrations: inProgress,
        abandonedRegistrations: totalUsers - completed - inProgress,
      });

    } catch (error) {
      this.logger.error(`Error getting stats: ${error}`);
      return Err(this.mapError(error));
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────

  private normalizePhoneNumber(phoneNumber: string): string {
    const cleaned = phoneNumber.replace(/[\s\-\(\)]/g, '');
    if (cleaned.startsWith('+')) return cleaned;
    if (cleaned.length === 10) return `+91${cleaned}`;
    return `+${cleaned}`;
  }

  private mapToProfile(doc: any): FarmerProfile {
    return {
      userId: doc.user_id,
      name: doc.name,
      stateCode: doc.profile?.stateCode,
      stateName: doc.profile?.stateName,
      districtCode: doc.profile?.districtCode,
      districtName: doc.profile?.districtName,
      blockCode: doc.profile?.blockCode,
      blockName: doc.profile?.blockName,
      villageCode: doc.profile?.villageCode,
      villageName: doc.profile?.villageName,
      isProfileComplete: doc.isProfileComplete,
      isRegistrationInProgress: doc.isRegistrationInProgress,
    };
  }

  private mapError(error: unknown): RepositoryError {
    if (error instanceof RepositoryError) return error;
    const msg = error instanceof Error ? error.message : String(error);

    if (msg.includes('duplicate key')) {
      return new RepositoryError('User exists', RepositoryErrorCode.DUPLICATE_KEY, error);
    }
    if (msg.includes('not found') || msg.includes('No document')) {
      return new RepositoryError('User not found', RepositoryErrorCode.NOT_FOUND, error);
    }
    if (msg.includes('timeout')) {
      return new RepositoryError('Timeout', RepositoryErrorCode.TIMEOUT, error);
    }
    return new RepositoryError(msg, RepositoryErrorCode.UNKNOWN, error);
  }
}