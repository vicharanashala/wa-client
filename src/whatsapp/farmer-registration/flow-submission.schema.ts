import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

export type FlowSubmissionDocument = HydratedDocument<FlowSubmissionModel>;

// ─────────────────────────────────────────────────────────────
// Flow Submission Schema
// ─────────────────────────────────────────────────────────────

@Schema({ collection: 'flow_submissions', timestamps: true, strict: true })
export class FlowSubmissionModel {
  // Optional user association (will be null for MVP with hardcoded Flow data)
  @Prop({ type: String, default: null, index: true })
  userId?: string | null;

  // Location data (IDs from Flow)
  @Prop({ required: true, type: String, index: true })
  stateCode!: string;

  @Prop({ required: true, type: String, index: true })
  districtCode!: string;

  @Prop({ required: true, type: String, index: true })
  blockCode!: string;

  @Prop({ required: true, type: String, index: true })
  villageCode!: string;

  // Human-readable names (if available from lookup)
  @Prop({ type: String })
  stateName?: string;

  @Prop({ type: String })
  districtName?: string;

  @Prop({ type: String })
  blockName?: string;

  @Prop({ type: String })
  villageName?: string;

  // Flow metadata
  @Prop({ type: String })
  flowToken?: string;

  @Prop({ type: String })
  flowId?: string;

  @Prop({ type: String })
  flowName?: string;

  // Timestamp of submission
  @Prop({ type: Date, default: Date.now, index: true })
  submittedAt!: Date;

  // Status
  @Prop({ type: String, default: 'completed', enum: ['pending', 'completed', 'failed'] })
  status!: string;

  // Error message if failed
  @Prop({ type: String })
  errorMessage?: string;
}

export const FlowSubmissionSchema = SchemaFactory.createForClass(FlowSubmissionModel);

// Indexes
FlowSubmissionSchema.index({ submittedAt: -1 });
FlowSubmissionSchema.index({ stateCode: 1, districtCode: 1, blockCode: 1, villageCode: 1 });