import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ConversationDocument = ConversationModel & Document;
@Schema({ _id: false })
export class MessageModel {
  @Prop({
    required: true,
    enum: ['user', 'chatbot', 'tool_call', 'tool_result'],
  })
  role: 'user' | 'chatbot' | 'tool_call' | 'tool_result';

  @Prop({ required: true })
  content: string; // transcription for voice, text for text

  @Prop()
  messageId?: string; // WhatsApp message ID

  @Prop({ default: false })
  isVoice?: boolean;

  @Prop({ default: null })
  audioStorageUrl?: string; // GCloud placeholder

  @Prop()
  toolCallId?: string;

  @Prop()
  toolName?: string;

  @Prop({ default: () => new Date() })
  timestamp: Date;
}

export const MessageModelSchema = SchemaFactory.createForClass(MessageModel);

@Schema({ collection: 'conversations', timestamps: true })
export class ConversationModel {
  @Prop({ required: true, unique: true, index: true })
  phoneNumber: string;

  @Prop({ type: [MessageModelSchema], default: [] })
  messages: MessageModel[];

  @Prop({
    type: { latitude: Number, longitude: Number, address: String },
    default: null,
  })
  location?: { latitude: number; longitude: number; address?: string };

  @Prop({ default: null })
  preferredLanguage?: string;

  @Prop({ default: null })
  userDetailsSummary?: string;
}

export const ConversationModelSchema =
  SchemaFactory.createForClass(ConversationModel);
