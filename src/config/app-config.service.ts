import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AppConfig,
  WhatsAppConfig,
  LlmConfig,
  McpConfig,
  AudioConfig,
  SarvamConfig,
  GeminiConfig,
  ReviewerConfig,
  ConversationConfig,
  DatabaseConfig,
  FeaturesConfig,
  RateLimitConfig,
  LoggingConfig,
} from './config.schema';

/**
 * Typed wrapper around ConfigService for type-safe configuration access
 *
 * Usage:
 * ```typescript
 * constructor(private readonly appConfig: AppConfigService) {}
 *
 * // Get entire config section
 * const llmConfig = this.appConfig.llm;
 * console.log(llmConfig.maxTokens);
 *
 * // Get specific values
 * const port = this.appConfig.app.port;
 * const model = this.appConfig.llm.defaultModel;
 * ```
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Get the entire configuration version
   */
  get version(): string {
    return this.configService.get<string>('version', '1.0.0');
  }

  /**
   * Application configuration
   */
  get app(): AppConfig {
    return this.configService.get<AppConfig>('app')!;
  }

  /**
   * WhatsApp configuration
   */
  get whatsapp(): WhatsAppConfig {
    return this.configService.get<WhatsAppConfig>('whatsapp')!;
  }

  /**
   * LLM configuration
   */
  get llm(): LlmConfig {
    return this.configService.get<LlmConfig>('llm')!;
  }

  /**
   * MCP configuration
   */
  get mcp(): McpConfig {
    return this.configService.get<McpConfig>('mcp')!;
  }

  /**
   * Audio configuration
   */
  get audio(): AudioConfig {
    return this.configService.get<AudioConfig>('audio')!;
  }

  /**
   * Sarvam AI configuration
   */
  get sarvam(): SarvamConfig {
    return this.configService.get<SarvamConfig>('sarvam')!;
  }

  /**
   * Gemini Live configuration
   */
  get gemini(): GeminiConfig {
    return this.configService.get<GeminiConfig>('gemini')!;
  }

  /**
   * Reviewer system configuration
   */
  get reviewer(): ReviewerConfig {
    return this.configService.get<ReviewerConfig>('reviewer')!;
  }

  /**
   * Conversation configuration
   */
  get conversation(): ConversationConfig {
    return this.configService.get<ConversationConfig>('conversation')!;
  }

  /**
   * Database configuration
   */
  get database(): DatabaseConfig {
    return this.configService.get<DatabaseConfig>('database')!;
  }

  /**
   * Feature flags
   */
  get features(): FeaturesConfig {
    return this.configService.get<FeaturesConfig>('features')!;
  }

  /**
   * Rate limiting configuration
   */
  get rateLimit(): RateLimitConfig {
    return this.configService.get<RateLimitConfig>('rateLimit')!;
  }

  /**
   * Logging configuration
   */
  get logging(): LoggingConfig {
    return this.configService.get<LoggingConfig>('logging')!;
  }

  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled(feature: keyof FeaturesConfig): boolean {
    return this.features[feature] === true;
  }

  /**
   * Get environment-specific values
   */
  get isDevelopment(): boolean {
    return this.app.environment === 'development';
  }

  get isProduction(): boolean {
    return this.app.environment === 'production';
  }

  get isTest(): boolean {
    return this.app.environment === 'test';
  }

  /**
   * Get all enabled text MCP servers
   */
  getEnabledTextMcpServers(): Record<string, { url: string }> {
    const servers = this.mcp.servers.text;
    return Object.entries(servers)
      .filter(([_, config]) => config.enabled)
      .reduce(
        (acc, [name, config]) => {
          acc[name] = { url: config.url };
          return acc;
        },
        {} as Record<string, { url: string }>,
      );
  }

  /**
   * Get all enabled voice MCP servers
   */
  getEnabledVoiceMcpServers(): Record<string, { url: string }> {
    const servers = this.mcp.servers.voice;
    return Object.entries(servers)
      .filter(([_, config]) => config.enabled)
      .reduce(
        (acc, [name, config]) => {
          acc[name] = { url: config.url };
          return acc;
        },
        {} as Record<string, { url: string }>,
      );
  }

  /**
   * Get a specific text MCP server by name
   */
  getTextMcpServer(
    serverName: string,
  ): { url: string; enabled: boolean } | null {
    const server = this.mcp.servers.text[serverName];
    return server ? { url: server.url, enabled: server.enabled } : null;
  }

  /**
   * Get a specific voice MCP server by name
   */
  getVoiceMcpServer(
    serverName: string,
  ): { url: string; enabled: boolean } | null {
    const server = this.mcp.servers.voice[serverName];
    return server ? { url: server.url, enabled: server.enabled } : null;
  }

  /**
   * Get all text MCP server names
   */
  getTextMcpServerNames(): string[] {
    return Object.keys(this.mcp.servers.text);
  }

  /**
   * Get all voice MCP server names
   */
  getVoiceMcpServerNames(): string[] {
    return Object.keys(this.mcp.servers.voice);
  }
}
