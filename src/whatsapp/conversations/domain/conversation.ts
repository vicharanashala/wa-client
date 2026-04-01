import { AggregateRoot } from '@nestjs/cqrs';
import {
  BotTextMessageAddedEvent,
  ConversationClearedEvent,
  ConversationCreatedEvent,
  LocationSetEvent,
  PreferredLanguageSetEvent,
  ToolCallAddedEvent,
  ToolResultAddedEvent,
  UserMessageAddedEvent,
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

  // ── Factory Methods ────────────────────────────────────────────────

  static create(phoneNumber: string): Conversation {
    const instance = new Conversation({
      phoneNumber: null!,
      messages: [],
      createdAt: null!,
    });

    instance.apply(new ConversationCreatedEvent(phoneNumber, new Date()));

    return instance;
  }

  static reconstitute(
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

  // ── Getters ────────────────────────────────────────────────────────

  get phoneNumber(): string {
    return this.props.phoneNumber;
  }

  get messages(): ReadonlyArray<Message> {
    return Object.freeze([...this.props.messages]);
  }

  get lastMessage(): Message | undefined {
    return this.props.messages.at(-1);
  }

  get messageCount(): number {
    return this.props.messages.length;
  }
  get preferredLanguage(): string | undefined {
    return this.props.preferredLanguage;
  }

  // ── Domain Methods ─────────────────────────────────────────────────

  addUserMessage(content: string, messageId: string): void {
    this.apply(
      new UserMessageAddedEvent(
        this.props.phoneNumber,
        content,
        messageId,
        new Date(),
      ),
    );
  }

  addBotTextMessage(content: string): void {
    this.apply(
      new BotTextMessageAddedEvent(this.props.phoneNumber, content, new Date()),
    );
  }

  addToolCall(toolCallId: string, toolName: string, input: string): void {
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

  addToolResult(toolCallId: string, toolName: string, result: string): void {
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
  clear(): void {
    this.apply(
      new ConversationClearedEvent(this.props.phoneNumber, new Date()),
    );
  }

  buildHistoryPrompt(): string {
    return this.props.messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content}`)
      .join('\n');
  }
  setLocation(latitude: number, longitude: number, address?: string): void {
    this.apply(
      new LocationSetEvent(
        this.props.phoneNumber,
        latitude,
        longitude,
        address,
      ),
    );
  }
  setPreferredLanguage(languageCode: string): void {
    this.apply(
      new PreferredLanguageSetEvent(this.props.phoneNumber, languageCode),
    );
  }
  addUserTextMessage(content: string, messageId: string): void {
    this.apply(
      new UserTextMessageAddedEvent(
        this.props.phoneNumber,
        content,
        new Date(),
        messageId,
      ),
    );
  }

  addUserVoiceMessage(
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

  private onUserTextMessageAddedEvent(event: UserTextMessageAddedEvent): void {
    this.props.messages.push({
      role: 'user',
      content: event.content,
      timestamp: event.timestamp,
      messageId: event.messageId,
      isVoice: false,
    });
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

  private onPreferredLanguageSetEvent(event: PreferredLanguageSetEvent): void {
    this.props.preferredLanguage = event.languageCode;
  }

  get location() {
    return this.props.location;
  }

  get hasLocation(): boolean {
    return !!this.props.location;
  }

  private onLocationSetEvent(event: LocationSetEvent): void {
    this.props.location = {
      latitude: event.latitude,
      longitude: event.longitude,
      address: event.address,
    };
  }

  // ── Event Handlers ─────────────────────────────────────────────────

  private onConversationCreatedEvent(event: ConversationCreatedEvent): void {
    this.props.phoneNumber = event.phoneNumber;
    this.props.messages = [];
    this.props.createdAt = event.createdAt;
  }

  private onUserMessageAddedEvent(event: UserMessageAddedEvent): void {
    this.props.messages.push({
      role: 'user',
      content: event.content,
      timestamp: event.timestamp,
    });
  }

  private onBotTextMessageAddedEvent(event: BotTextMessageAddedEvent): void {
    this.props.messages.push({
      role: 'chatbot',
      content: event.content,
      timestamp: event.timestamp,
    });
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

  private onToolResultAddedEvent(event: ToolResultAddedEvent): void {
    this.props.messages.push({
      role: 'tool_result',
      content: event.result,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      timestamp: event.timestamp,
    });
  }

  private onConversationClearedEvent(_event: ConversationClearedEvent): void {
    this.props.messages = [];
  }
}
