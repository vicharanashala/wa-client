import { AggregateRoot } from '@nestjs/cqrs';
import {
  BotTextMessageAddedEvent,
  ConversationClearedEvent,
  ConversationCreatedEvent,
  LocationSetEvent,
  PreferredLanguageSetEvent,
  ToolCallAddedEvent,
  ToolResultAddedEvent,
  UserDetailsSummarySetEvent,
  UserTextMessageAddedEvent,
  UserVoiceMessageAddedEvent,
  ThreadIdSetEvent,
} from './conversation.events';

/**
 * Represents the role of a message in the conversation.
 * @public
 */
export type MessageRole = 'user' | 'chatbot' | 'tool_call' | 'tool_result';

/**
 * Represents a single message in a conversation.
 * @public
 */
export interface Message {
  /** The role of the message sender */
  role: MessageRole;

  /** The text content of the message */
  content: string;

  /** The timestamp when the message was created */
  timestamp: Date;

  /** WhatsApp message ID for tracking purposes */
  messageId?: string;

  /** Unique identifier for a tool call, used to correlate tool calls with their results */
  toolCallId?: string;

  /** Name of the tool being called or that produced the result */
  toolName?: string;

  /** Indicates if the original message was a voice note */
  isVoice?: boolean;

  /** URL to the stored audio file in cloud storage (GCloud/S3) */
  audioStorageUrl?: string;
}

/**
 * Internal properties of the Conversation aggregate.
 * @internal
 */
interface ConversationProps {
  /** The phone number associated with this conversation */
  phoneNumber: string;

  /** Ordered list of all messages in the conversation */
  messages: Message[];

  /** Optional location information shared by the user */
  location?: {
    /** Latitude coordinate */
    latitude: number;
    /** Longitude coordinate */
    longitude: number;
    /** Human-readable address */
    address?: string;
  };

  /** User's preferred language code (e.g., 'en', 'es') */
  preferredLanguage?: string;

  /** Summary of user details gathered during the conversation */
  userDetailsSummary?: string;

  /** Timestamp when the conversation was created */
  createdAt: Date;

  /** Aegra Server Thread ID for stateful conversation tracking */
  threadId?: string;
}

/**
 * Manages WhatsApp conversation state and history.
 *
 * This class handles all messages, location data, and user preferences for a single
 * conversation identified by a phone number. All state changes are recorded as events
 * for tracking and auditing purposes.
 *
 * @public
 */
export class Conversation extends AggregateRoot {
  /** Internal state properties of the conversation */
  private props: ConversationProps;

  /**
   * Private constructor to enforce factory method usage.
   *
   * @param props - The initial properties for the conversation
   * @internal
   */
  private constructor(props: ConversationProps) {
    super();
    this.props = props;
  }

  /**
   * Creates a new conversation.
   *
   * This is the primary way to create new conversations in the system.
   *
   * @param phoneNumber - The phone number associated with this conversation
   * @returns A new Conversation instance
   *
   * @example
   * ```typescript
   * const conversation = Conversation.create('+1234567890');
   * ```
   */
  public static create(phoneNumber: string): Conversation {
    const instance = new Conversation({
      phoneNumber: null!,
      messages: [],
      createdAt: null!,
    });

    instance.apply(new ConversationCreatedEvent(phoneNumber, new Date()));

    return instance;
  }

  /**
   * Handles the conversation created event.
   *
   * Initializes the conversation properties when a new conversation is created.
   * This method is automatically called by the framework.
   *
   * @param event - The conversation created event
   * @internal
   */
  private onConversationCreatedEvent(event: ConversationCreatedEvent): void {
    this.props.phoneNumber = event.phoneNumber;
    this.props.messages = [];
    this.props.createdAt = event.createdAt;
  }

  /**
   * Restores a conversation from saved data.
   *
   * Used when loading a conversation from the database.
   * Unlike {@link create}, this method does not emit any events.
   *
   * @param phoneNumber - The phone number associated with this conversation
   * @param messages - The list of messages to restore
   * @param location - Optional location data
   * @param preferredLanguage - Optional preferred language code
   * @param userDetailsSummary - Optional user details summary string
   * @returns A restored Conversation instance
   *
   * @example
   * ```typescript
   * const conversation = Conversation.reconstitute(
   *   '+1234567890',
   *   messagesFromDb,
   *   { latitude: 40.7128, longitude: -74.0060, address: 'New York, NY' },
   *   'en',
   *   'User is a software developer interested in AI'
   * );
   * ```
   */
  public static reconstitute(
    phoneNumber: string,
    messages: Message[],
    location?: { latitude: number; longitude: number; address?: string },
    preferredLanguage?: string,
    userDetailsSummary?: string,
    threadId?: string,
  ): Conversation {
    return new Conversation({
      phoneNumber,
      messages,
      createdAt: new Date(),
      location,
      preferredLanguage,
      userDetailsSummary,
      threadId,
    });
  }

  /**
   * Gets the phone number associated with this conversation.
   * @returns The phone number
   */
  get phoneNumber(): string {
    return this.props.phoneNumber;
  }

  /**
   * Gets a read-only copy of all messages in the conversation.
   *
   * @remarks
   * Returns a frozen array to prevent external modifications to the message history.
   *
   * @returns Read-only array of messages
   */
  get messages(): ReadonlyArray<Message> {
    return Object.freeze([...this.props.messages]);
  }

  /**
   * Gets the user's preferred language code.
   * @returns The preferred language code or undefined if not set
   */
  get preferredLanguage(): string | undefined {
    return this.props.preferredLanguage;
  }

  /**
   * Gets the user's location data.
   * @returns The location object or undefined if not set
   */
  get location() {
    return this.props.location;
  }

  /**
   * Gets the user details summary.
   * @returns The user details summary string or undefined if not set
   */
  get userDetailsSummary(): string | undefined {
    return this.props.userDetailsSummary;
  }

  /**
   * Checks if the user has shared their location.
   * @returns True if location data is available, false otherwise
   */
  get hasLocation(): boolean {
    return !!this.props.location;
  }

  /**
   * Gets the thread ID for the Aegra server.
   * @returns The thread ID string or undefined if not set
   */
  get threadId(): string | undefined {
    return this.props.threadId;
  }

  /**
   * Sets the thread ID for this conversation.
   *
   * @param threadId - The thread ID string
   */
  public setThreadId(threadId: string): void {
    this.apply(
      new ThreadIdSetEvent(this.props.phoneNumber, threadId),
    );
  }

  /**
   * Handles the thread ID set event.
   *
   * @param event - The thread ID set event
   * @internal
   */
  private onThreadIdSetEvent(event: ThreadIdSetEvent): void {
    this.props.threadId = event.threadId;
  }

  /**
   * Adds a text message from the chatbot to the conversation.
   *
   * @param content - The text content of the bot's message
   *
   * @example
   * ```typescript
   * conversation.addBotTextMessage('Hello! How can I help you today?');
   * ```
   */
  public addBotTextMessage(content: string): void {
    this.apply(
      new BotTextMessageAddedEvent(this.props.phoneNumber, content, new Date()),
    );
  }

  /**
   * Handles the bot text message added event.
   *
   * Appends the bot's message to the conversation history.
   *
   * @param event - The bot text message added event
   * @internal
   */
  private onBotTextMessageAddedEvent(event: BotTextMessageAddedEvent): void {
    this.props.messages.push({
      role: 'chatbot',
      content: event.content,
      timestamp: event.timestamp,
    });
  }

  /**
   * Sets the user's location for this conversation.
   *
   * This can be used for location-based features like finding nearby services.
   *
   * @param latitude - The latitude coordinate
   * @param longitude - The longitude coordinate
   * @param address - Optional human-readable address
   *
   * @example
   * ```typescript
   * conversation.setLocation(40.7128, -74.0060, 'New York, NY');
   * ```
   */
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

  /**
   * Handles the location set event.
   *
   * Updates the conversation's location data.
   *
   * @param event - The location set event
   * @internal
   */
  private onLocationSetEvent(event: LocationSetEvent): void {
    this.props.location = {
      latitude: event.latitude,
      longitude: event.longitude,
      address: event.address,
    };
  }

  /**
   * Sets the user's preferred language for this conversation.
   *
   * This can be used to provide localized responses.
   *
   * @param languageCode - ISO language code (e.g., 'en', 'es', 'fr')
   *
   * @example
   * ```typescript
   * conversation.setPreferredLanguage('es');
   * ```
   */
  public setPreferredLanguage(languageCode: string): void {
    this.apply(
      new PreferredLanguageSetEvent(this.props.phoneNumber, languageCode),
    );
  }

  /**
   * Handles the preferred language set event.
   *
   * Updates the conversation's preferred language setting.
   *
   * @param event - The preferred language set event
   * @internal
   */
  private onPreferredLanguageSetEvent(event: PreferredLanguageSetEvent): void {
    this.props.preferredLanguage = event.languageCode;
  }

  /**
   * Sets the user details summary for this conversation.
   *
   * This can be used to store a summary of user information gathered during the conversation.
   *
   * @param userDetailsSummary - Summary string containing user details
   *
   * @example
   * ```typescript
   * conversation.setUserDetailsSummary('User is a software developer interested in AI and machine learning');
   * ```
   */
  public setUserDetailsSummary(userDetailsSummary: string): void {
    this.apply(
      new UserDetailsSummarySetEvent(
        this.props.phoneNumber,
        userDetailsSummary,
      ),
    );
  }

  /**
   * Handles the user details summary set event.
   *
   * Updates the conversation's user details summary.
   *
   * @param event - The user details summary set event
   * @internal
   */
  private onUserDetailsSummarySetEvent(
    event: UserDetailsSummarySetEvent,
  ): void {
    this.props.userDetailsSummary = event.userDetailsSummary;
  }

  /**
   * Adds a text message from the user to the conversation.
   *
   * @param content - The text content of the user's message
   * @param messageId - WhatsApp message ID for tracking
   *
   * @example
   * ```typescript
   * conversation.addUserTextMessage('Hello!', 'wamid.xyz123');
   * ```
   */
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

  /**
   * Handles the user text message added event.
   *
   * Appends the user's text message to the conversation history.
   *
   * @param event - The user text message added event
   * @internal
   */
  private onUserTextMessageAddedEvent(event: UserTextMessageAddedEvent): void {
    this.props.messages.push({
      role: 'user',
      content: event.content,
      timestamp: event.timestamp,
      messageId: event.messageId,
      isVoice: false,
    });
  }

  /**
   * Adds a voice message from the user to the conversation.
   *
   * The voice message is stored with its transcription and optionally
   * a reference to the audio file in cloud storage.
   *
   * @param transcript - The text transcription of the voice message
   * @param messageId - WhatsApp message ID for tracking
   * @param audioStorageUrl - Optional URL to the stored audio file (GCloud/S3)
   *
   * @example
   * ```typescript
   * conversation.addUserVoiceMessage(
   *   'Hello, this is a voice message',
   *   'wamid.xyz123',
   *   'gs://bucket/audio/xyz123.ogg'
   * );
   * ```
   */
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

  /**
   * Handles the user voice message added event.
   *
   * Appends the user's voice message (as transcription) to the conversation history,
   * along with metadata indicating it was originally a voice note and optionally
   * the storage URL for the audio file.
   *
   * @param event - The user voice message added event
   * @internal
   */
  private onUserVoiceMessageAddedEvent(
    event: UserVoiceMessageAddedEvent,
  ): void {
    this.props.messages.push({
      role: 'user',
      content: event.transcript,
      timestamp: event.timestamp,
      messageId: event.messageId,
      isVoice: true,
      audioStorageUrl: event.audioStorageUrl,
    });
  }

  /**
   * Adds a tool call message to the conversation.
   *
   * Records when the chatbot invokes an external tool or API.
   *
   * @param toolCallId - Unique identifier for this tool call
   * @param toolName - Name of the tool being called
   * @param input - Input parameters or data passed to the tool
   *
   * @example
   * ```typescript
   * conversation.addToolCall(
   *   'call_123',
   *   'weather_api',
   *   '{"location": "New York"}'
   * );
   * ```
   */
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

  /**
   * Handles the tool call added event.
   *
   * Appends the tool call to the conversation history for tracking purposes.
   *
   * @param event - The tool call added event
   * @internal
   */
  private onToolCallAddedEvent(event: ToolCallAddedEvent): void {
    this.props.messages.push({
      role: 'tool_call',
      content: event.input,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      timestamp: event.timestamp,
    });
  }

  /**
   * Adds a tool result message to the conversation.
   *
   * Records the result returned from a tool call.
   * The toolCallId should match the ID from the corresponding {@link addToolCall}.
   *
   * @param toolCallId - Unique identifier matching the original tool call
   * @param toolName - Name of the tool that produced the result
   * @param result - The result data returned by the tool
   *
   * @example
   * ```typescript
   * conversation.addToolResult(
   *   'call_123',
   *   'weather_api',
   *   '{"temperature": 72, "conditions": "sunny"}'
   * );
   * ```
   */
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

  /**
   * Handles the tool result added event.
   *
   * Appends the tool result to the conversation history, allowing the
   * chatbot to use this information in subsequent responses.
   *
   * @param event - The tool result added event
   * @internal
   */
  private onToolResultAddedEvent(event: ToolResultAddedEvent): void {
    this.props.messages.push({
      role: 'tool_result',
      content: event.result,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      timestamp: event.timestamp,
    });
  }

  /**
   * Clears all messages from the conversation.
   *
   * This operation removes the message history while preserving other
   * conversation data like location and language preferences.
   *
   * @remarks
   * This is useful when implementing a "clear history" or "start new conversation"
   * feature.
   *
   * @example
   * ```typescript
   * conversation.clear();
   * ```
   */
  public clear(): void {
    this.apply(
      new ConversationClearedEvent(this.props.phoneNumber, new Date()),
    );
  }

  /**
   * Handles the conversation cleared event.
   *
   * Removes all messages from the conversation history.
   *
   * @param _event - The conversation cleared event (unused but required by framework)
   * @internal
   */
  private onConversationClearedEvent(_event: ConversationClearedEvent): void {
    this.props.messages = [];
  }

  /**
   * Builds a formatted text representation of the conversation history.
   *
   * Creates a simple prompt-style string showing the conversation history,
   * useful for feeding into language models or displaying conversation summaries.
   *
   * @returns A formatted string with each message on a new line
   *
   * @example
   * ```typescript
   * const prompt = conversation.buildHistoryPrompt();
   * // Returns:
   * // "User: Hello
   * // Bot: Hi there! How can I help?
   * // User: What's the weather?"
   * ```
   */
  public buildHistoryPrompt(): string {
    return this.props.messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content}`)
      .join('\n');
  }
}
