import { Result } from 'oxide.ts';
import { RepositoryError, RepositoryErrorCode } from '../user-details/user-details.repository';
import { SimplifiedFlowData } from './farmer-registration.service';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface FlowSubmission {
  id: string;
  userId?: string | null;
  stateCode: string;
  districtCode: string;
  blockCode: string;
  villageCode: string;
  stateName?: string;
  districtName?: string;
  blockName?: string;
  villageName?: string;
  flowToken?: string;
  submittedAt: Date;
  status: string;
}

export interface CreateFlowSubmissionParams {
  userId?: string | null;
  data: SimplifiedFlowData;
  flowToken?: string;
  stateName?: string;
  districtName?: string;
  blockName?: string;
  villageName?: string;
}

// ─────────────────────────────────────────────────────────────
// Repository Interface
// ─────────────────────────────────────────────────────────────

export abstract class FlowSubmissionRepository {
  /**
   * Create a new flow submission
   */
  abstract createSubmission(params: CreateFlowSubmissionParams): Promise<Result<FlowSubmission, RepositoryError>>;

  /**
   * Get submissions for a user
   */
  abstract getSubmissionsByUser(userId: string): Promise<Result<FlowSubmission[], RepositoryError>>;

  /**
   * Get recent submissions
   */
  abstract getRecentSubmissions(limit: number): Promise<Result<FlowSubmission[], RepositoryError>>;
}