import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { LangGraphClientService } from './langgraph-client.service';
import { AddUserTextMessageHandler } from './application/add-user-text-message/add-user-text-message.command';
import { SetUserLocationHandler } from './application/set-user-location/set-user-location.command';
import { AddUserVoiceMessageHandler } from './application/add-user-voice-message/add-user-voice-message.command';
import { WhatsappApiModule } from '../whatsapp-api/whatsapp-api.module';
import { SarvamModule } from '../sarvam-api/sarvam.module';
import { PendingQuestionsModule } from '../pending-questions/pending-questions.module';

@Module({
  imports: [
    CqrsModule,
    WhatsappApiModule,
    SarvamModule,
    PendingQuestionsModule,
  ],
  providers: [
    LangGraphClientService,
    AddUserTextMessageHandler,
    SetUserLocationHandler,
    AddUserVoiceMessageHandler,
  ],
  exports: [LangGraphClientService],
})
export class ConversationModule {}
