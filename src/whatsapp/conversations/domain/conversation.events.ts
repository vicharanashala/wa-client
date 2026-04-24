export class ConversationCreatedEvent {
  constructor(
    public readonly phoneNumber: string,
    public readonly createdAt: Date,
  ) {}
}

export class UserTextMessageAddedEvent {
  constructor(
    public readonly phoneNumber: string,
    public readonly content: string,
    public readonly timestamp: Date,
    public readonly messageId: string,
  ) {}
}

export class UserVoiceMessageAddedEvent {
  constructor(
    public readonly phoneNumber: string,
    public readonly transcript: string,
    public readonly timestamp: Date,
    public readonly messageId: string,
    public readonly audioStorageUrl?: string, // placeholder for GCloud
  ) {}
}

export class BotTextMessageAddedEvent {
  constructor(
    public readonly phoneNumber: string,
    public readonly content: string,
    public readonly timestamp: Date,
  ) {}
}

export class ToolCallAddedEvent {
  constructor(
    public readonly phoneNumber: string,
    public readonly toolCallId: string,
    public readonly toolName: string,
    public readonly input: string,
    public readonly timestamp: Date,
  ) {}
}

export class ToolResultAddedEvent {
  constructor(
    public readonly phoneNumber: string,
    public readonly toolCallId: string,
    public readonly toolName: string,
    public readonly result: string,
    public readonly timestamp: Date,
  ) {}
}

export class ConversationClearedEvent {
  constructor(
    public readonly phoneNumber: string,
    public readonly clearedAt: Date,
  ) {}
}

export class LocationSetEvent {
  constructor(
    public readonly phoneNumber: string,
    public readonly latitude: number,
    public readonly longitude: number,
    public readonly address?: string,
  ) {}
}

export class PreferredLanguageSetEvent {
  constructor(
    public readonly phoneNumber: string,
    public readonly languageCode: string,
  ) {}
}

export class UserDetailsSummarySetEvent {
  constructor(
    public readonly phoneNumber: string,
    public readonly userDetailsSummary: string,
  ) {}
}

export class ReviewerUploadRequestedEvent {
  constructor(
    public readonly phoneNumber: string,
    public readonly queryText: string,
    public readonly payload: any,
  ) {}
}

export class ThreadIdSetEvent {
  constructor(
    public readonly phoneNumber: string,
    public readonly threadId: string,
  ) {}
}
