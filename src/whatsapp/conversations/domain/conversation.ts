import { AggregateRoot } from '@nestjs/cqrs';
import {
  BotTextMessageAddedEvent,
  ConversationClearedEvent,
  ConversationCreatedEvent,
  LocationSetEvent,
  PreferredLanguageSetEvent,
  ToolCallAddedEvent,
  ToolResultAddedEvent,
  UserTextMessageAddedEvent,
  UserVoiceMessageAddedEvent,
} from './conversation.events';

export type MessageRole = 'user' | 'chatbot' | 'tool_call' | 'tool_result';

export interface Message {
  role: MessageRole;
  content: string;
  timestamp: Date;
  messageId?: string; // WhatsApp message ID for every message
  toolCallId?: string;
  toolName?: string;
  isVoice?: boolean; // true if original was a voice note
  audioStorageUrl?: string; // placeholder for GCloud/S3 URL later
}

interface ConversationProps {
  phoneNumber: string;
  messages: Message[];
  location?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  preferredLanguage?: string;
  createdAt: Date;
}

export class Conversation extends AggregateRoot {
  private props: ConversationProps;

  private constructor(props: ConversationProps) {
    super();
    this.props = props;
  }

  public static create(phoneNumber: string): Conversation {
    const instance = new Conversation({
      phoneNumber: null!,
      messages: [],
      createdAt: null!,
    });

    instance.apply(new ConversationCreatedEvent(phoneNumber, new Date()));

    return instance;
  }

  private onConversationCreatedEvent(event: ConversationCreatedEvent): void {
    this.props.phoneNumber = event.phoneNumber;
    this.props.messages = [];
    this.props.createdAt = event.createdAt;
  }

  public static reconstitute(
    phoneNumber: string,
    messages: Message[],
    location?: { latitude: number; longitude: number; address?: string },
    preferredLanguage?: string,
  ): Conversation {
    return new Conversation({
      phoneNumber,
      messages,
      createdAt: new Date(),
      location,
      preferredLanguage,
    });
  }

  get phoneNumber(): string {
    return this.props.phoneNumber;
  }

  get messages(): ReadonlyArray<Message> {
    return Object.freeze([...this.props.messages]);
  }

  get preferredLanguage(): string | undefined {
    return this.props.preferredLanguage;
  }

  get location() {
    return this.props.location;
  }

  get hasLocation(): boolean {
    return !!this.props.location;
  }

  public addBotTextMessage(content: string): void {
    this.apply(
      new BotTextMessageAddedEvent(this.props.phoneNumber, content, new Date()),
    );
  }

  private onBotTextMessageAddedEvent(event: BotTextMessageAddedEvent): void {
    this.props.messages.push({
      role: 'chatbot',
      content: event.content,
      timestamp: event.timestamp,
    });
  }

  public setLocation(
    latitude: number,
    longitude: number,
    address?: string,
  ): void {
    this.apply(
      new LocationSetEvent(
        this.props.phoneNumber,
        latitude,
        longitude,
        address,
      ),
    );
  }

  private onLocationSetEvent(event: LocationSetEvent): void {
    this.props.location = {
      latitude: event.latitude,
      longitude: event.longitude,
      address: event.address,
    };
  }

  public setPreferredLanguage(languageCode: string): void {
    this.apply(
      new PreferredLanguageSetEvent(this.props.phoneNumber, languageCode),
    );
  }

  private onPreferredLanguageSetEvent(event: PreferredLanguageSetEvent): void {
    this.props.preferredLanguage = event.languageCode;
  }

  public addUserTextMessage(content: string, messageId: string): void {
    this.apply(
      new UserTextMessageAddedEvent(
        this.props.phoneNumber,
        content,
        new Date(),
        messageId,
      ),
    );
  }

  private onUserTextMessageAddedEvent(event: UserTextMessageAddedEvent): void {
    this.props.messages.push({
      role: 'user',
      content: event.content,
      timestamp: event.timestamp,
      messageId: event.messageId,
      isVoice: false,
    });
  }

  public addUserVoiceMessage(
    transcript: string,
    messageId: string,
    audioStorageUrl?: string,
  ): void {
    this.apply(
      new UserVoiceMessageAddedEvent(
        this.props.phoneNumber,
        transcript,
        new Date(),
        messageId,
        audioStorageUrl,
      ),
    );
  }

  private onUserVoiceMessageAddedEvent(
    event: UserVoiceMessageAddedEvent,
  ): void {
    this.props.messages.push({
      role: 'user',
      content: event.transcript, // store transcription as content
      timestamp: event.timestamp,
      messageId: event.messageId,
      isVoice: true,
      audioStorageUrl: event.audioStorageUrl, // null for now, GCloud later
    });
  }

  public addToolCall(
    toolCallId: string,
    toolName: string,
    input: string,
  ): void {
    this.apply(
      new ToolCallAddedEvent(
        this.props.phoneNumber,
        toolCallId,
        toolName,
        input,
        new Date(),
      ),
    );
  }

  private onToolCallAddedEvent(event: ToolCallAddedEvent): void {
    this.props.messages.push({
      role: 'tool_call',
      content: event.input,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      timestamp: event.timestamp,
    });
  }

  public addToolResult(
    toolCallId: string,
    toolName: string,
    result: string,
  ): void {
    this.apply(
      new ToolResultAddedEvent(
        this.props.phoneNumber,
        toolCallId,
        toolName,
        result,
        new Date(),
      ),
    );
  }

  private onToolResultAddedEvent(event: ToolResultAddedEvent): void {
    this.props.messages.push({
      role: 'tool_result',
      content: event.result,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      timestamp: event.timestamp,
    });
  }

  public clear(): void {
    this.apply(
      new ConversationClearedEvent(this.props.phoneNumber, new Date()),
    );
  }

  private onConversationClearedEvent(_event: ConversationClearedEvent): void {
    this.props.messages = [];
  }

  public buildHistoryPrompt(): string {
    return this.props.messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content}`)
      .join('\n');
  }
}
