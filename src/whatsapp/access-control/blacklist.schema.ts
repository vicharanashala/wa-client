import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BlacklistDocument = BlacklistModel & Document;

@Schema({ collection: 'blacklist', timestamps: true })
export class BlacklistModel {
  @Prop({ required: true, unique: true, index: true })
  phoneNumber: string; 

  @Prop({ required: true })
  name: string; // identifier / label

  @Prop({ default: null })
  reason?: string; // why this number was blacklisted

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: null })
  addedBy?: string;
}

export const BlacklistModelSchema =
  SchemaFactory.createForClass(BlacklistModel);
