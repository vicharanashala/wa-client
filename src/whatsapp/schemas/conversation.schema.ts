import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export type ConversationDocument = Conversation & Document;

@Schema({
  timestamps: true,
  collection: 'conversations',
})
export class Conversation {
  @Prop({ required: true, unique: true, index: true })
  phoneNumber: string;

  @Prop({
    type: [
      {
        role: { type: String, enum: ['system', 'user', 'assistant'], required: true },
        content: { type: String, required: true },
      },
    ],
    default: [],
  })
  messages: ChatCompletionMessageParam[];

  @Prop({ default: Date.now })
  lastActivity: Date;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

// Indexes for better query performance
ConversationSchema.index({ phoneNumber: 1 });
ConversationSchema.index({ lastActivity: -1 });
