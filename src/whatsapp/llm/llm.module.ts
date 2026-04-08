// src/whatsapp/llm/llm.module.ts
import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { QuestionClassifierService } from './question-classifier.service';

@Module({
  providers: [LlmService, QuestionClassifierService],
  exports: [LlmService, QuestionClassifierService],
})
export class LlmModule {}
