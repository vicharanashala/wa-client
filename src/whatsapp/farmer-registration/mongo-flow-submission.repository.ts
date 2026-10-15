import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Result, Ok, Err } from 'oxide.ts';
import {
  FlowSubmissionModel,
  FlowSubmissionDocument,
} from './flow-submission.schema';
import {
  FlowSubmissionRepository,
  FlowSubmission,
  CreateFlowSubmissionParams,
} from './flow-submission.repository';
import { RepositoryError, RepositoryErrorCode } from '../user-details/user-details.repository';

// ─────────────────────────────────────────────────────────────
// Repository Implementation
// ─────────────────────────────────────────────────────────────

@Injectable()
export class MongoFlowSubmissionRepository implements FlowSubmissionRepository {
  private readonly logger = new Logger(MongoFlowSubmissionRepository.name);

  constructor(
    @InjectModel(FlowSubmissionModel.name)
    private readonly flowSubmissionModel: Model<FlowSubmissionDocument>,
  ) {}

  async createSubmission(params: CreateFlowSubmissionParams): Promise<Result<FlowSubmission, RepositoryError>> {
    try {
      const doc = await this.flowSubmissionModel.create({
        userId: params.userId ?? null,
        stateCode: params.data.state!,
        districtCode: params.data.district!,
        blockCode: params.data.block!,
        villageCode: params.data.village!,
        stateName: params.stateName,
        districtName: params.districtName,
        blockName: params.blockName,
        villageName: params.villageName,
        flowToken: params.flowToken,
        submittedAt: new Date(),
        status: 'completed',
      });

      this.logger.log(`Created flow submission: ${String(doc._id)}`);
      
      return Ok(this.mapToSubmission(doc));

    } catch (error) {
      this.logger.error(`Error creating flow submission: ${error}`);
      return Err(this.mapError(error));
    }
  }

  async getSubmissionsByUser(userId: string): Promise<Result<FlowSubmission[], RepositoryError>> {
    try {
      const docs = await this.flowSubmissionModel
        .find({ userId })
        .sort({ submittedAt: -1 })
        .lean()
        .exec();

      return Ok(docs.map((doc) => this.mapToSubmission(doc)));

    } catch (error) {
      this.logger.error(`Error getting submissions for user ${userId}: ${error}`);
      return Err(this.mapError(error));
    }
  }

  async getRecentSubmissions(limit: number): Promise<Result<FlowSubmission[], RepositoryError>> {
    try {
      const docs = await this.flowSubmissionModel
        .find()
        .sort({ submittedAt: -1 })
        .limit(limit)
        .lean()
        .exec();

      return Ok(docs.map((doc) => this.mapToSubmission(doc)));

    } catch (error) {
      this.logger.error(`Error getting recent submissions: ${error}`);
      return Err(this.mapError(error));
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────

  private mapToSubmission(doc: any): FlowSubmission {
    return {
      id: String(doc._id),
      userId: doc.userId,
      stateCode: doc.stateCode,
      districtCode: doc.districtCode,
      blockCode: doc.blockCode,
      villageCode: doc.villageCode,
      stateName: doc.stateName,
      districtName: doc.districtName,
      blockName: doc.blockName,
      villageName: doc.villageName,
      flowToken: doc.flowToken,
      submittedAt: doc.submittedAt,
      status: doc.status,
    };
  }

  private mapError(error: unknown): RepositoryError {
    if (error instanceof RepositoryError) return error;
    const msg = error instanceof Error ? error.message : String(error);

    if (msg.includes('duplicate key')) {
      return new RepositoryError('Submission exists', RepositoryErrorCode.DUPLICATE_KEY, error);
    }
    if (msg.includes('timeout')) {
      return new RepositoryError('Timeout', RepositoryErrorCode.TIMEOUT, error);
    }
    return new RepositoryError(msg, RepositoryErrorCode.UNKNOWN, error);
  }
}