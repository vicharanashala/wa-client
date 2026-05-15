import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import {
  PendingQuestionModel,
  PendingQuestionModelSchema,
} from './pending-question.schema';
import { PendingQuestionRepository } from './pending-question.repository';
import { MongoPendingQuestionRepository } from './mongo-pending-question.repository';
import { ReviewerAnswerLocalizationService } from './reviewer-answer-localization.service';
import { ReviewerPollingService } from './reviewer-polling.service';
import { WhatsappApiModule } from '../whatsapp-api/whatsapp-api.module';
import { LangGraphModule } from '../conversations/langgraph.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: PendingQuestionModel.name, schema: PendingQuestionModelSchema },
    ]),
    WhatsappApiModule,
    LangGraphModule,
  ],
  providers: [
    {
      provide: PendingQuestionRepository,
      useClass: MongoPendingQuestionRepository,
    },
    ReviewerAnswerLocalizationService,
    ReviewerPollingService,
  ],
  exports: [PendingQuestionRepository, ReviewerPollingService],
})
export class PendingQuestionsModule {}
