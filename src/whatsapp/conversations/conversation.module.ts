import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { LangGraphModule } from './langgraph.module';
import { AddUserTextMessageHandler } from './application/add-user-text-message/add-user-text-message.command';
import { SetUserLocationHandler } from './application/set-user-location/set-user-location.command';
import { AddUserVoiceMessageHandler } from './application/add-user-voice-message/add-user-voice-message.command';
import { WhatsappApiModule } from '../whatsapp-api/whatsapp-api.module';
import { SarvamModule } from '../sarvam-api/sarvam.module';
import { PendingQuestionsModule } from '../pending-questions/pending-questions.module';

@Module({
  imports: [
    CqrsModule,
    LangGraphModule,
    WhatsappApiModule,
    SarvamModule,
    PendingQuestionsModule,
  ],
  providers: [
    AddUserTextMessageHandler,
    SetUserLocationHandler,
    AddUserVoiceMessageHandler,
  ],
  exports: [LangGraphModule],
})
export class ConversationModule {}
