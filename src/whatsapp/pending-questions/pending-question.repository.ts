import { PendingQuestionModel } from './pending-question.schema';

export interface CreatePendingQuestionDto {
  questionId: string;
  phoneNumber: string;
  queryText: string;
  toolCallId: string;
  // WhatsApp wamid of the user's original message; used to send the future
  // reviewer answer as a quoted reply to that exact message.
  originalMessageId?: string;
}

export abstract class PendingQuestionRepository {
  abstract create(dto: CreatePendingQuestionDto): Promise<void>;
  abstract findAllPending(): Promise<PendingQuestionModel[]>;
  abstract findByQuestionId(questionId: string): Promise<PendingQuestionModel | null>;
  abstract markAnswered(questionId: string, answer: string): Promise<void>;
  abstract markNotified(questionId: string): Promise<void>;
}
