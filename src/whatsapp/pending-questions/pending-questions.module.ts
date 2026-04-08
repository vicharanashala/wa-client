import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import {
  PendingQuestionModel,
  PendingQuestionModelSchema,
} from './pending-question.schema';
import { PendingQuestionRepository } from './pending-question.repository';
import { MongoPendingQuestionRepository } from './mongo-pending-question.repository';
import { ReviewerPollingService } from './reviewer-polling.service';
import { WhatsappApiModule } from '../whatsapp-api/whatsapp-api.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: PendingQuestionModel.name, schema: PendingQuestionModelSchema },
    ]),
    WhatsappApiModule,
  ],
  providers: [
    {
      provide: PendingQuestionRepository,
      useClass: MongoPendingQuestionRepository,
    },
    ReviewerPollingService,
  ],
  exports: [PendingQuestionRepository, ReviewerPollingService],
})
export class PendingQuestionsModule {}
