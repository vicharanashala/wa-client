import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDetailsDocument = UserDetailsModel & Document;

@Schema({ collection: 'user_details', timestamps: true })
export class UserDetailsModel {
  @Prop({ required: true, unique: true, index: true })
  user_id!: string;

  @Prop({ type: String, default: null })
  last_rephrased_query?: string | null;

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