import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PendingQuestionDocument = PendingQuestionModel & Document;

@Schema({ collection: 'pending_questions', timestamps: true })
export class PendingQuestionModel {
  @Prop({ required: true, index: true })
  questionId: string; // UUID from reviewer system

  @Prop({ required: true, index: true })
  phoneNumber: string; // User's WhatsApp number

  @Prop({ required: true })
  queryText: string; // Original question text for context

  @Prop({ required: true })
  toolCallId: string; // LangChain tool_call_id for traceability

  @Prop({
    required: true,
    enum: ['pending', 'answered', 'notified'],
    default: 'pending',
    index: true,
  })
  status: 'pending' | 'answered' | 'notified';

  @Prop({ default: null })
  answer?: string; // Filled once reviewer system responds

  @Prop({ default: null })
  answeredAt?: Date;

  @Prop({ default: null })
  notifiedAt?: Date;
}

export const PendingQuestionModelSchema =
  SchemaFactory.createForClass(PendingQuestionModel);

// Compound index for efficient polling queries
PendingQuestionModelSchema.index({ status: 1, createdAt: 1 });
