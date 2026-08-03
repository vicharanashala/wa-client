import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ScriptDetectionService } from '../script-detection/script-detection.service';
import { WhatsappService } from '../whatsapp-api/whatsapp.service';

interface TimelineEntry {
  after_seconds: number;
  messages: string[];
}

interface ScriptMessageSet {
  timeline: TimelineEntry[];
}

interface ProgressMessagesConfig {
  default_script: string;
  update_interval_seconds: number;
  scripts: Record<string, ScriptMessageSet>;
}

interface ActiveSession {
  active: boolean;
  lastMessage?: string;
  messageId: string;
  pendingSend?: Promise<void>;
  phoneNumber: string;
  script: string;
  startedAt: number;
  timer?: NodeJS.Timeout;
}

export interface ResponseProgressSession {
  stop(): Promise<void>;
}

@Injectable()
export class ResponseProgressService implements OnModuleInit {
  private readonly logger = new Logger(ResponseProgressService.name);
  private config!: ProgressMessagesConfig;
  private readonly sessions = new Map<string, ActiveSession>();

  constructor(
    private readonly scriptDetectionService: ScriptDetectionService,
    private readonly whatsappService: WhatsappService,
  ) {}

  onModuleInit(): void {
    this.config = this.loadConfig();
  }

  async start(params: {
    phoneNumber: string;
    messageId: string;
    sourceText: string;
  }): Promise<ResponseProgressSession> {
    const existing = this.sessions.get(params.messageId);
    if (existing) {
      await this.stop(existing);
    }

    const session: ActiveSession = {
      active: true,
      messageId: params.messageId,
      phoneNumber: params.phoneNumber,
      script: this.scriptDetectionService.detect_script(params.sourceText),
      startedAt: Date.now(),
    };
    this.sessions.set(session.messageId, session);

    await this.sendForElapsedTime(session, 0);
    this.scheduleNext(session);

    return { stop: () => this.stop(session) };
  }

  private scheduleNext(session: ActiveSession): void {
    if (!session.active) return;

    const intervalMs = this.config.update_interval_seconds * 1000;
    const elapsedMs = Date.now() - session.startedAt;
    const nextTickMs = (Math.floor(elapsedMs / intervalMs) + 1) * intervalMs;
    const delayMs = Math.max(0, nextTickMs - elapsedMs);

    session.timer = setTimeout(async () => {
      if (!session.active) return;

      session.pendingSend = this.sendForElapsedTime(
        session,
        (Date.now() - session.startedAt) / 1000,
      );
      await session.pendingSend;
      session.pendingSend = undefined;
      this.scheduleNext(session);
    }, delayMs);
    session.timer.unref?.();
  }

  private async sendForElapsedTime(
    session: ActiveSession,
    elapsedSeconds: number,
  ): Promise<void> {
    if (!session.active) return;

    const message = this.selectMessage(
      session.script,
      elapsedSeconds,
      session.lastMessage,
    );
    session.lastMessage = message;

    try {
      await this.whatsappService.sendTextMessage(session.phoneNumber, message);
    } catch (error: any) {
      this.logger.error(
        `[${session.phoneNumber}] Failed to send progress message: ${error?.message ?? error}`,
      );
    }
  }

  private selectMessage(
    detectedScript: string,
    elapsedSeconds: number,
    previousMessage?: string,
  ): string {
    const messageSet =
      this.config.scripts[detectedScript] ??
      this.config.scripts[this.config.default_script];
    const eligibleEntries = messageSet.timeline.filter(
      (entry) => entry.after_seconds <= elapsedSeconds,
    );
    const entry = eligibleEntries[eligibleEntries.length - 1];
    const choices =
      entry.messages.length > 1 && previousMessage
        ? entry.messages.filter((message) => message !== previousMessage)
        : entry.messages;

    return choices[Math.floor(Math.random() * choices.length)];
  }

  private async stop(session: ActiveSession): Promise<void> {
    if (!session.active) {
      await session.pendingSend;
      return;
    }

    session.active = false;
    if (session.timer) clearTimeout(session.timer);
    if (this.sessions.get(session.messageId) === session) {
      this.sessions.delete(session.messageId);
    }
    await session.pendingSend;
  }

  private loadConfig(): ProgressMessagesConfig {
    const possiblePaths = [
      path.join(__dirname, 'progress-messages.json'),
      path.join(
        process.cwd(),
        'src',
        'whatsapp',
        'conversations',
        'progress-messages.json',
      ),
    ];

    for (const filePath of possiblePaths) {
      if (!fs.existsSync(filePath)) continue;

      try {
        const config = JSON.parse(
          fs.readFileSync(filePath, 'utf-8'),
        ) as ProgressMessagesConfig;
        this.validateConfig(config, filePath);
        this.logger.log(`Loaded response progress messages from: ${filePath}`);
        return config;
      } catch (error: any) {
        throw new Error(
          `Invalid response progress messages at ${filePath}: ${error?.message ?? error}`,
        );
      }
    }

    throw new Error('progress-messages.json was not found');
  }

  private validateConfig(
    config: ProgressMessagesConfig,
    filePath: string,
  ): void {
    if (!config || typeof config !== 'object') {
      throw new Error('configuration must be a JSON object');
    }
    if (
      !Number.isInteger(config.update_interval_seconds) ||
      config.update_interval_seconds <= 0
    ) {
      throw new Error('update_interval_seconds must be a positive integer');
    }
    if (!config.default_script || !config.scripts?.[config.default_script]) {
      throw new Error('default_script must reference an entry in scripts');
    }

    for (const [script, messageSet] of Object.entries(config.scripts)) {
      const timeline = messageSet?.timeline;
      if (!Array.isArray(timeline) || timeline.length === 0) {
        throw new Error(
          `scripts.${script}.timeline must contain at least one entry`,
        );
      }
      if (timeline[0].after_seconds !== 0) {
        throw new Error(`scripts.${script}.timeline must start at 0 seconds`);
      }

      let previousThreshold = -1;
      for (const entry of timeline) {
        if (
          !Number.isInteger(entry.after_seconds) ||
          entry.after_seconds < 0 ||
          entry.after_seconds <= previousThreshold
        ) {
          throw new Error(
            `scripts.${script}.timeline thresholds must be increasing integers`,
          );
        }
        if (
          !Array.isArray(entry.messages) ||
          entry.messages.length === 0 ||
          entry.messages.some((message) => !message.trim())
        ) {
          throw new Error(
            `scripts.${script}.timeline at ${entry.after_seconds}s must contain messages`,
          );
        }
        previousThreshold = entry.after_seconds;
      }
    }

    this.logger.debug(`Validated response progress configuration: ${filePath}`);
  }
}
