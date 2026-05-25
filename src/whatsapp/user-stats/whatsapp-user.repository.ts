import { WhatsappUserModel } from './whatsapp-user.schema';

export interface FindUsersParams {
  skip?: number;
  limit?: number;
  isPaginated: boolean;
}

export interface WhatsappUserListItem {
  phoneNumber: string;
  messageCount: number;
  firstMessageAt: Date;
  lastMessageAt: Date;
  firstMessageText: string | null;
  lastMessageText: string;
}

export interface FindUsersResult {
  data: WhatsappUserListItem[];
  total: number;
  skip: number;
  limit: number;
  isPaginated: boolean;
}

export abstract class WhatsappUserRepository {
  abstract recordMessage(
    phoneNumber: string,
    messageText: string,
  ): Promise<void>;

  abstract findAll(params: FindUsersParams): Promise<FindUsersResult>;

  abstract countUniqueUsers(): Promise<number>;
}
