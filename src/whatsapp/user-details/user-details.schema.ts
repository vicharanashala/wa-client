import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

export type UserDetailsDocument = HydratedDocument<UserDetailsModel>;

// ─────────────────────────────────────────────────────────────
// Location Sub-Schema (Embedded Document)
// ─────────────────────────────────────────────────────────────

@Schema({ _id: false, versionKey: false })
export class LocationProfile {
  @Prop({ required: true, type: Number })
  stateCode!: number;

  @Prop({ required: true, type: String })
  stateName!: string;

  @Prop({ required: true, type: Number })
  districtCode!: number;

  @Prop({ required: true, type: String })
  districtName!: string;

  @Prop({ required: true, type: Number })
  blockCode!: number;

  @Prop({ required: true, type: String })
  blockName!: string;

  @Prop({ required: true, type: Number })
  villageCode!: number;

  @Prop({ required: true, type: String })
  villageName!: string;
}

// ─────────────────────────────────────────────────────────────
// Registration Step Sub-Schema
// ─────────────────────────────────────────────────────────────

@Schema({ _id: false, versionKey: false })
export class RegistrationStep {
  @Prop({ required: true, type: Number, default: 0 })
  currentStep!: number;

  @Prop({ required: true, type: String })
  stepName!: string;

  @Prop({ type: Date })
  startedAt?: Date;

  @Prop({ type: Date })
  lastUpdatedAt?: Date;
}

// ─────────────────────────────────────────────────────────────
// Main Schema
// ─────────────────────────────────────────────────────────────

@Schema({ collection: 'user_details', timestamps: true, strict: true })
export class UserDetailsModel {
  @Prop({
    required: true,
    unique: true,
    index: true,
    trim: true,
  })
  user_id!: string;

  // Farmer's name
  @Prop({ type: String, default: null, trim: true, maxlength: 100 })
  name?: string | null;

  // Full location profile (embedded document)
  @Prop({ type: LocationProfile, default: null })
  profile?: LocationProfile | null;

  // Registration state tracking
  @Prop({ type: RegistrationStep, default: null })
  registrationStep?: RegistrationStep | null;

  // Flag: has farmer completed registration?
  @Prop({ type: Boolean, default: false, index: true })
  isProfileComplete!: boolean;

  // Flag: is registration in progress?
  @Prop({ type: Boolean, default: false, index: true })
  isRegistrationInProgress!: boolean;

  // Last query stored for context
  @Prop({ type: String, default: null })
  last_rephrased_query?: string | null;

  // Legacy location field (kept for backward compatibility)
  @Prop({ type: Object, default: null })
  current_location?: {
    district?: string;
    state?: string;
  } | null;

  @Prop({ type: Date })
  created_at!: Date;

  @Prop({ type: Date })
  updated_at!: Date;
}

export const UserDetailsModelSchema =
  SchemaFactory.createForClass(UserDetailsModel);

// Compound index for efficient queries
UserDetailsModelSchema.index({ isProfileComplete: 1, isRegistrationInProgress: 1 });
UserDetailsModelSchema.index({ 'profile.stateCode': 1, 'profile.districtCode': 1 });
UserDetailsModelSchema.index({ updated_at: -1 });