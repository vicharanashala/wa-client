import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type WhatsappUserDocument = WhatsappUserModel & Document;

@Schema({ collection: 'whatsapp_users', timestamps: true })
export class WhatsappUserModel {
  @Prop({ required: true, unique: true, index: true })
  phoneNumber: string;

  @Prop({ required: true, default: 0 })
  messageCount: number;

  @Prop({ required: true })
  firstMessageAt: Date;

  @Prop({ required: true })
  lastMessageAt: Date;

  @Prop({ required: true })
  lastMessageText: string;

  /** First LangGraph-bound message text; set once on insert (null for legacy rows). */
  @Prop({ type: String, default: null })
  firstMessageText?: string | null;
}

export const WhatsappUserModelSchema =
  SchemaFactory.createForClass(WhatsappUserModel);

WhatsappUserModelSchema.index({ lastMessageAt: -1 });
