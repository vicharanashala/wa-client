import { Result } from 'oxide.ts';
import { LocationProfile } from './user-details.schema';

// ─────────────────────────────────────────────────────────────
// Error Types
// ─────────────────────────────────────────────────────────────

export class RepositoryError extends Error {
  constructor(
    message: string,
    public readonly code: RepositoryErrorCode,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'RepositoryError';
  }
}

export enum RepositoryErrorCode {
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  TIMEOUT = 'TIMEOUT',
  DUPLICATE_KEY = 'DUPLICATE_KEY',
  NOT_FOUND = 'NOT_FOUND',
  OPTIMISTIC_LOCK_FAILED = 'OPTIMISTIC_LOCK_FAILED',
  UNKNOWN = 'UNKNOWN',
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface FarmerProfile {
  userId: string;
  name?: string | null;
  stateCode?: number;
  stateName?: string;
  districtCode?: number;
  districtName?: string;
  blockCode?: number;
  blockName?: string;
  villageCode?: number;
  villageName?: string;
  isProfileComplete: boolean;
  isRegistrationInProgress: boolean;
}

export interface UserCheckResult {
  exists: boolean;
  profile: FarmerProfile | null;
  shouldStartRegistration: boolean;
  shouldResumeRegistration: boolean;
}

export interface RegistrationStats {
  totalUsers: number;
  completedRegistrations: number;
  inProgressRegistrations: number;
  abandonedRegistrations: number;
}

// ─────────────────────────────────────────────────────────────
// Repository Interface
// ─────────────────────────────────────────────────────────────

export abstract class UserDetailsRepository {
  /**
   * Get last rephrased query (existing functionality)
   */
  abstract getLastRephrasedQuery(userId: string): Promise<string | null>;

  /**
   * Check if user exists and determine registration status
   */
  abstract checkUserStatus(userId: string): Promise<Result<UserCheckResult, RepositoryError>>;

  /**
   * Create initial user document (for new users)
   */
  abstract createUser(userId: string): Promise<Result<void, RepositoryError>>;

  /**
   * Update farmer's name
   */
  abstract updateName(userId: string, name: string): Promise<Result<void, RepositoryError>>;

  /**
   * Update location profile
   */
  abstract updateLocationProfile(
    userId: string,
    profile: LocationProfile,
  ): Promise<Result<void, RepositoryError>>;

  /**
   * Complete registration
   */
  abstract completeRegistration(userId: string): Promise<Result<void, RepositoryError>>;

  /**
   * Cancel/abandon registration
   */
  abstract cancelRegistration(userId: string): Promise<Result<void, RepositoryError>>;

  /**
   * Get user profile by ID
   */
  abstract getProfile(userId: string): Promise<Result<FarmerProfile | null, RepositoryError>>;

  /**
   * Get registration statistics
   */
  abstract getStats(): Promise<Result<RegistrationStats, RepositoryError>>;
}
