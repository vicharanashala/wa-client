import { Conversation } from '../domain/conversation';

export abstract class ConversationRepository {
  abstract findByPhone(phoneNumber: string): Promise<Conversation | null>;
  abstract save(conversation: Conversation): Promise<void>;
  abstract delete(phoneNumber: string): Promise<boolean>;
}
