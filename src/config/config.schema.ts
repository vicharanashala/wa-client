import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  Min,
  Max,
  IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';

// Enums
export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export enum LogLevel {
  Error = 'error',
  Warn = 'warn',
  Info = 'info',
  Debug = 'debug',
}

// App Configuration
export class AppConfig {
  @IsString()
  name: string;

  @IsEnum(Environment)
  environment: Environment;

  @IsNumber()
  @Min(1024)
  @Max(65535)
  port: number;

  @IsEnum(LogLevel)
  logLevel: LogLevel;
}

// WhatsApp Configuration
export class WhatsAppApiConfig {
  @IsString()
  version: string;

  @IsString()
  @IsUrl()
  baseUrl: string;
}

export class WhatsAppMessagesConfig {
  @IsString()
  locationRequest: string;

  @IsString()
  disclaimer: string;

  @IsString()
  clearSuccess: string;

  @IsString()
  helpMessage: string;

  @IsString()
  fallbackResponse: string;

  @IsString()
  expertAnswerNotification: string;
}

export class WhatsAppConfig {
  @ValidateNested()
  @Type(() => WhatsAppApiConfig)
  api: WhatsAppApiConfig;

  @ValidateNested()
  @Type(() => WhatsAppMessagesConfig)
  messages: WhatsAppMessagesConfig;
}

// LLM Configuration
export class LlmConfig {
  @IsString()
  defaultModel: string;

  @IsNumber()
  @Min(1)
  @Max(32000)
  maxTokens: number;

  @IsNumber()
  @Min(0)
  @Max(2)
  temperature: number;

  @IsNumber()
  @Min(-2)
  @Max(2)
  presencePenalty: number;

  @IsNumber()
  @Min(-2)
  @Max(2)
  frequencyPenalty: number;

  @IsString()
  systemPrompt: string;
}

// MCP Configuration
export class McpServerConfig {
  @IsString()
  @IsUrl()
  url: string;

  @IsBoolean()
  enabled: boolean;
}

// Dynamic MCP servers - allows any server name
// Text servers: Record<string, McpServerConfig>
// Voice servers: Record<string, McpServerConfig>
export class McpServersConfig {
  // Note: Using 'any' type for dynamic keys - validated at runtime
  // This allows flexible server names like: reviewer, golden, pop, market, etc.
  text: Record<string, McpServerConfig>;
  voice: Record<string, McpServerConfig>;
}

export class McpProtocolConfig {
  @IsString()
  version: string;
}

export class McpClientConfig {
  @IsString()
  name: string;

  @IsString()
  version: string;

  @IsString()
  onConnectionError: string;
}

export class McpConfig {
  @ValidateNested()
  @Type(() => McpProtocolConfig)
  protocol: McpProtocolConfig;

  @ValidateNested()
  @Type(() => McpClientConfig)
  client: McpClientConfig;

  @ValidateNested()
  @Type(() => McpServersConfig)
  servers: McpServersConfig;
}

// Audio Configuration
export class OpusConfig {
  @IsNumber()
  sampleRate: number;

  @IsNumber()
  @Min(1)
  @Max(2)
  channels: number;

  @IsNumber()
  frameDurationMs: number;

  @IsNumber()
  payloadType: number;

  @IsNumber()
  bitrate: number;
}

export class GeminiAudioConfig {
  @IsNumber()
  sampleRate: number;

  @IsNumber()
  defaultSampleRate: number;
}

export class AudioConfig {
  @ValidateNested()
  @Type(() => OpusConfig)
  opus: OpusConfig;

  @ValidateNested()
  @Type(() => GeminiAudioConfig)
  gemini: GeminiAudioConfig;
}

// Sarvam Configuration
export class SarvamSttConfig {
  @IsString()
  model: string;

  @IsString()
  mode: string;

  @IsString()
  defaultLanguage: string;
}

export class SarvamTtsConfig {
  @IsString()
  model: string;

  @IsString()
  outputCodec: string;

  @IsNumber()
  sampleRate: number;

  @IsNumber()
  textChunkSize: number;
}

export class SarvamConfig {
  @IsString()
  @IsUrl()
  baseUrl: string;

  @ValidateNested()
  @Type(() => SarvamSttConfig)
  stt: SarvamSttConfig;

  @ValidateNested()
  @Type(() => SarvamTtsConfig)
  tts: SarvamTtsConfig;
}

// Gemini Live Configuration
export class GeminiLiveConfig {
  @IsString()
  wsUrl: string;

  @IsString()
  model: string;

  @IsArray()
  @IsString({ each: true })
  responseModalities: string[];

  @IsString()
  systemInstruction: string;

  @IsString()
  greetingPrompt: string;

  @IsNumber()
  @Min(30)
  maxCallDurationSeconds: number;

  @IsNumber()
  @Min(5)
  silenceTimeoutSeconds: number;
}

export class GeminiConfig {
  @ValidateNested()
  @Type(() => GeminiLiveConfig)
  live: GeminiLiveConfig;
}

// Reviewer Configuration
export class ReviewerPollingConfig {
  @IsBoolean()
  enabled: boolean;

  @IsNumber()
  @Min(60000) // Minimum 1 minute
  intervalMs: number;

  @IsNumber()
  @Min(0)
  initialDelayMs: number;
}

export class ReviewerApiEndpointsConfig {
  @IsString()
  pendingQuestions: string;

  @IsString()
  markReviewed: string;
}

export class ReviewerApiConfig {
  @IsString()
  @IsUrl()
  defaultBaseUrl: string;

  @ValidateNested()
  @Type(() => ReviewerApiEndpointsConfig)
  endpoints: ReviewerApiEndpointsConfig;
}

export class ReviewerConfig {
  @ValidateNested()
  @Type(() => ReviewerPollingConfig)
  polling: ReviewerPollingConfig;

  @ValidateNested()
  @Type(() => ReviewerApiConfig)
  api: ReviewerApiConfig;
}

// Conversation Configuration
export class ConversationConfig {
  @IsNumber()
  @Min(1)
  messageHistoryLimit: number;

  @IsBoolean()
  enableContextMemory: boolean;

  @IsNumber()
  @Min(256)
  maxContextLength: number;
}

// Database Configuration
export class MongoDbOptionsConfig {
  @IsBoolean()
  retryWrites: boolean;

  @IsString()
  w: string;
}

export class MongoDbConfig {
  @ValidateNested()
  @Type(() => MongoDbOptionsConfig)
  options: MongoDbOptionsConfig;
}

export class RedisOptionsConfig {
  @IsNumber()
  maxRetriesPerRequest: number;

  @IsBoolean()
  enableReadyCheck: boolean;

  @IsBoolean()
  lazyConnect: boolean;
}

export class RedisConfig {
  @ValidateNested()
  @Type(() => RedisOptionsConfig)
  options: RedisOptionsConfig;
}

export class DatabaseConfig {
  @ValidateNested()
  @Type(() => MongoDbConfig)
  mongodb: MongoDbConfig;

  @ValidateNested()
  @Type(() => RedisConfig)
  redis: RedisConfig;
}

// Feature Flags
export class FeaturesConfig {
  @IsBoolean()
  enableVoiceCalls: boolean;

  @IsBoolean()
  enableTextChat: boolean;

  @IsBoolean()
  enableReviewerPolling: boolean;

  @IsBoolean()
  enableLocationServices: boolean;

  @IsBoolean()
  enableMcpTools: boolean;

  @IsBoolean()
  enableCaching: boolean;
}

// Rate Limiting
export class RateLimitConfig {
  @IsBoolean()
  enabled: boolean;

  @IsNumber()
  @Min(1000)
  windowMs: number;

  @IsNumber()
  @Min(1)
  maxRequests: number;
}

// Logging Configuration
export class LoggingLevelsConfig {
  @IsString()
  default: string;

  @IsString()
  whatsapp: string;

  @IsString()
  llm: string;

  @IsString()
  mcp: string;

  @IsString()
  calling: string;
}

export class LoggingConfig {
  @IsString()
  format: string;

  @IsBoolean()
  includeTimestamp: boolean;

  @IsBoolean()
  includeContext: boolean;

  @ValidateNested()
  @Type(() => LoggingLevelsConfig)
  levels: LoggingLevelsConfig;
}

// Root Configuration Schema
export class ConfigSchema {
  @IsOptional()
  @IsString()
  version?: string;

  @ValidateNested()
  @Type(() => AppConfig)
  app: AppConfig;

  @ValidateNested()
  @Type(() => WhatsAppConfig)
  whatsapp: WhatsAppConfig;

  @ValidateNested()
  @Type(() => LlmConfig)
  llm: LlmConfig;

  @ValidateNested()
  @Type(() => McpConfig)
  mcp: McpConfig;

  @ValidateNested()
  @Type(() => AudioConfig)
  audio: AudioConfig;

  @ValidateNested()
  @Type(() => SarvamConfig)
  sarvam: SarvamConfig;

  @ValidateNested()
  @Type(() => GeminiConfig)
  gemini: GeminiConfig;

  @ValidateNested()
  @Type(() => ReviewerConfig)
  reviewer: ReviewerConfig;

  @ValidateNested()
  @Type(() => ConversationConfig)
  conversation: ConversationConfig;

  @ValidateNested()
  @Type(() => DatabaseConfig)
  database: DatabaseConfig;

  @ValidateNested()
  @Type(() => FeaturesConfig)
  features: FeaturesConfig;

  @ValidateNested()
  @Type(() => RateLimitConfig)
  rateLimit: RateLimitConfig;

  @ValidateNested()
  @Type(() => LoggingConfig)
  logging: LoggingConfig;
}
