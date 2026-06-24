import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { LanguageSupportService } from '../language-support/language-support.service';

/**
 * Detects Indian scripts from text and returns localized acknowledgment messages.
 */
@Injectable()
export class ScriptDetectionService implements OnModuleInit {
  private readonly logger = new Logger(ScriptDetectionService.name);
  private scriptMessages: Map<string, string> = new Map();
  constructor(private readonly languageSupport: LanguageSupportService) {}
  private readonly defaultMessage =
    '🌱 Thank you for the question. The answer is getting generated, please wait for sometime...';

  onModuleInit(): void {
    this.loadScriptMessages();
  }

  /**
   * Loads script messages from the CSV file.
   */
  private loadScriptMessages(): void {
    try {
      const csvPath = path.join(__dirname, 'acknowledgment-translations.csv');

      // Try alternative paths for different build environments
      const possiblePaths = [
        csvPath,
        path.join(
          __dirname,
          '..',
          'script-detection',
          'acknowledgment-translations.csv',
        ),
        path.join(
          process.cwd(),
          'src',
          'whatsapp',
          'script-detection',
          'acknowledgment-translations.csv',
        ),
        path.join(
          process.cwd(),
          'dist',
          'whatsapp',
          'script-detection',
          'acknowledgment-translations.csv',
        ),
      ];

      let csvContent = '';
      for (const tryPath of possiblePaths) {
        if (fs.existsSync(tryPath)) {
          csvContent = fs.readFileSync(tryPath, 'utf-8');
          this.logger.log(`Loaded scripts.csv from: ${tryPath}`);
          break;
        }
      }

      if (!csvContent) {
        this.logger.warn(
          'scripts.csv not found, using default English message',
        );
        this.scriptMessages.set('English', this.defaultMessage);
        return;
      }

      // Parse CSV
      const lines = csvContent.split('\n').filter((line) => line.trim());

      // Skip header
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        // Handle CSV parsing with quoted values
        const match = line.match(/^([^,]+),"?(.+?)"?$/);
        if (match) {
          const scriptName = match[1].trim();
          let message = match[2].trim();
          // Remove trailing quote if present
          if (message.endsWith('"')) {
            message = message.slice(0, -1);
          }
          this.scriptMessages.set(scriptName, message);
        }
      }

      this.logger.log(`Loaded ${this.scriptMessages.size} script messages`);
    } catch (error) {
      this.logger.error(`Failed to load scripts.csv: ${error}`);
      this.scriptMessages.set('English', this.defaultMessage);
    }
  }

  /**
   * Detects the script in the given text by counting characters per script.
   * Returns the script with the highest character count.
   */
  detect_script(text: string): string {
    const scriptLanguage = this.languageSupport.detectScriptLanguage(text);
    this.logger.debug(`Script detection for text: ${scriptLanguage}`);
    return scriptLanguage;
  }

  /**
   * Gets the localized acknowledgment message for the given text.
   * Detects the script and returns the appropriate message from the CSV.
   */
  getLocalizedMessage(text: string): string {
    const detectedScript = this.detect_script(text);
    const message = this.scriptMessages.get(detectedScript);

    if (message) {
      this.logger.debug(
        `Returning ${detectedScript} message for detected script`,
      );
      return message;
    }

    this.logger.debug(
      `No message found for ${detectedScript}, returning English default`,
    );
    return this.scriptMessages.get('English') || this.defaultMessage;
  }
}
