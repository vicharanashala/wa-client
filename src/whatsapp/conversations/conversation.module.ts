import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { LangGraphModule } from './langgraph.module';
import { AddUserTextMessageHandler } from './application/add-user-text-message/add-user-text-message.command';
import { SetUserLocationHandler } from './application/set-user-location/set-user-location.command';
import { AddUserVoiceMessageHandler } from './application/add-user-voice-message/add-user-voice-message.command';
import { WhatsappApiModule } from '../whatsapp-api/whatsapp-api.module';
import { SarvamModule } from '../sarvam-api/sarvam.module';
import { MurfModule } from '../murf-api/murf.module';
import { PendingQuestionsModule } from '../pending-questions/pending-questions.module';
import { UserStatsModule } from '../user-stats/user-stats.module';
import { UserDetailsModule } from '../user-details/user-details.module';
import { ScriptDetectionModule } from '../script-detection/script-detection.module';
import { ResponseProgressService } from './response-progress.service';

@Module({
  imports: [
    CqrsModule,
    LangGraphModule,
    WhatsappApiModule,
    SarvamModule,
    MurfModule,
    PendingQuestionsModule,
    UserStatsModule,
    UserDetailsModule,
    ScriptDetectionModule,
  ],
  providers: [
    AddUserTextMessageHandler,
    SetUserLocationHandler,
    AddUserVoiceMessageHandler,
    ResponseProgressService,
  ],
  exports: [LangGraphModule],
})
export class ConversationModule {}
