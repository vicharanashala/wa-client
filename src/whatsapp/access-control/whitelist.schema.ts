import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type WhitelistDocument = WhitelistModel & Document;

@Schema({ collection: 'whitelist', timestamps: true })
export class WhitelistModel {
  @Prop({ required: true, unique: true, index: true })
  phoneNumber: string; 

  @Prop({ required: true })
  name: string; 

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: null })
  addedBy?: string; 

  @Prop({ default: null })
  notes?: string; 
}

export const WhitelistModelSchema =
  SchemaFactory.createForClass(WhitelistModel);
