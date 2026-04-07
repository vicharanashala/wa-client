import { PendingQuestionModel } from './pending-question.schema';

export interface CreatePendingQuestionDto {
  questionId: string;
  phoneNumber: string;
  queryText: string;
  toolCallId: string;
}

export abstract class PendingQuestionRepository {
  abstract create(dto: CreatePendingQuestionDto): Promise<void>;
  abstract findAllPending(): Promise<PendingQuestionModel[]>;
  abstract markAnswered(questionId: string, answer: string): Promise<void>;
  abstract markNotified(questionId: string): Promise<void>;
}
