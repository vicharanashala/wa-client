import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ConversationModel,
  ConversationModelSchema,
} from './infrastructure/conversation.schema';
import { MongoConversationRepository } from './infrastructure/mongo-conversation.repository';
import { ConversationEventHandlers } from './domain/conversation.event-handlers';
import { ConversationRepository } from './infrastructure/conversation.repository';
import { AddUserTextMessageHandler } from './application/add-user-text-message/add-user-text-message.command';
import { WhatsappApiModule } from '../whatsapp-api/whatsapp-api.module';
import { LlmModule } from '../llm/llm.module';
import { SetUserLocationHandler } from './application/set-user-location/set-user-location.command';
import { SarvamModule } from '../sarvam-api/sarvam.module';
import { AddUserVoiceMessageHandler } from './application/add-user-voice-message/add-user-voice-message.command';

@Module({
  imports: [
    CqrsModule,
    MongooseModule.forFeature([
      { name: ConversationModel.name, schema: ConversationModelSchema },
    ]),
    WhatsappApiModule,
    LlmModule,
    SarvamModule
  ],
  providers: [
    { provide: ConversationRepository, useClass: MongoConversationRepository },
    AddUserTextMessageHandler,
    SetUserLocationHandler,
    AddUserVoiceMessageHandler,
    ...ConversationEventHandlers,
  ],
  exports: [ConversationRepository],
})
export class ConversationModule {}
