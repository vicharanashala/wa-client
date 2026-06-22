import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

interface ScriptEntry {
  name: string;
  message: string;
}

interface ScriptCount {
  script: string;
  count: number;
}

/**
 * Detects Indian scripts from text and returns localized acknowledgment messages.
 */
@Injectable()
export class ScriptDetectionService implements OnModuleInit {
  private readonly logger = new Logger(ScriptDetectionService.name);
  private scriptMessages: Map<string, string> = new Map();
  private readonly defaultMessage = '🌱 Thank you for the question. The answer is getting generated, please wait for sometime...';

  // Unicode ranges for Indian scripts
  private readonly scriptRanges: { script: string; ranges: RegExp[] }[] = [
    {
      script: 'Devanagari',
      ranges: [/[\u0900-\u097F]/],
    },
    {
      script: 'Bengali-Assamese',
      ranges: [/[\u0980-\u09FF]/],
    },
    {
      script: 'Gurmukhi',
      ranges: [/[\u0A00-\u0A7F]/],
    },
    {
      script: 'Gujarati',
      ranges: [/[\u0A80-\u0AFF]/],
    },
    {
      script: 'Odia',
      ranges: [/[\u0B00-\u0B7F]/],
    },
    {
      script: 'Tamil',
      ranges: [/[\u0B80-\u0BFF]/],
    },
    {
      script: 'Telugu',
      ranges: [/[\u0C00-\u0C7F]/],
    },
    {
      script: 'Kannada',
      ranges: [/[\u0C80-\u0CFF]/],
    },
    {
      script: 'Malayalam',
      ranges: [/[\u0D00-\u0DFF]/],
    },
    {
      script: 'Perso-Arabic',
      ranges: [/[\u0600-\u06FF]/, /[\u0750-\u077F]/, /[\u08A0-\u08FF]/],
    },
    {
      script: 'Ol Chiki',
      ranges: [/[\u1C50-\u1C7F]/],
    },
    {
      script: 'Meitei Mayek',
      ranges: [/[\uABC0-\uABFF]/, /[\uAAE0-\uAAFF]/],
    },
  ];

  onModuleInit(): void {
    this.loadScriptMessages();
  }

  /**
   * Loads script messages from the CSV file.
   */
  private loadScriptMessages(): void {
    try {
      const csvPath = path.join(__dirname, 'scripts.csv');
      
      // Try alternative paths for different build environments
      const possiblePaths = [
        csvPath,
        path.join(__dirname, '..', 'script-detection', 'scripts.csv'),
        path.join(process.cwd(), 'src', 'whatsapp', 'script-detection', 'scripts.csv'),
        path.join(process.cwd(), 'dist', 'whatsapp', 'script-detection', 'scripts.csv'),
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
        this.logger.warn('scripts.csv not found, using default English message');
        this.scriptMessages.set('English', this.defaultMessage);
        return;
      }

      // Parse CSV
      const lines = csvContent.split('\n').filter(line => line.trim());
      
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
    if (!text || !text.trim()) {
      return 'English';
    }

    const scriptCounts: ScriptCount[] = [];

    for (const { script, ranges } of this.scriptRanges) {
      let count = 0;
      for (const range of ranges) {
        const matches = text.match(new RegExp(range, 'g'));
        count += matches ? matches.length : 0;
      }
      if (count > 0) {
        scriptCounts.push({ script, count });
      }
    }

    if (scriptCounts.length === 0) {
      return 'English';
    }

    // Sort by count descending and return the script with highest count
    scriptCounts.sort((a, b) => b.count - a.count);
    
    this.logger.debug(`Script detection for text: ${scriptCounts.map(s => `${s.script}:${s.count}`).join(', ')}`);
    
    return scriptCounts[0].script;
  }

  /**
   * Gets the localized acknowledgment message for the given text.
   * Detects the script and returns the appropriate message from the CSV.
   */
  getLocalizedMessage(text: string): string {
    const detectedScript = this.detect_script(text);
    const message = this.scriptMessages.get(detectedScript);
    
    if (message) {
      this.logger.debug(`Returning ${detectedScript} message for detected script`);
      return message;
    }

    this.logger.debug(`No message found for ${detectedScript}, returning English default`);
    return this.scriptMessages.get('English') || this.defaultMessage;
  }
}
