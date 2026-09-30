import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';

export interface FFVQARecord {
  question: string;
  shortAnswer: string;
  bigAnswer: string;
}

export interface FFVQAResult {
  found: boolean;
  shortAnswer?: string;
  bigAnswer?: string;
  questionId?: string;
}

@Injectable()
export class FFVService implements OnModuleInit {
  private readonly logger = new Logger(FFVService.name);
  private qaRecords: FFVQARecord[] = [];
  private questionIdMap: Map<string, FFVQARecord> = new Map();
  // Track last question asked per phone number for "more" flow
  private lastQuestionMap: Map<string, string> = new Map();

  constructor(private configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.loadCSVData();
  }

  /**
   * Load and parse the FFV Q&A CSV data
   */
  private async loadCSVData(): Promise<void> {
    const csvPath = process.env.FFV_CSV_PATH || path.join(process.cwd(), 'data', 'ffv-data.csv');

    try {
      if (!fs.existsSync(csvPath)) {
        this.logger.warn(`FFV CSV file not found at: ${csvPath}`);
        this.logger.warn('FFV feature will be disabled');
        return;
      }

      const csvContent = fs.readFileSync(csvPath, 'utf-8');
      this.qaRecords = this.parseCSV(csvContent);
      
      // Build question ID map for quick lookup
      this.questionIdMap.clear();
      this.qaRecords.forEach((record, index) => {
        const questionId = `ffv_q_${index + 1}`;
        this.questionIdMap.set(questionId, record);
      });

      this.logger.log(`FFV: Loaded ${this.qaRecords.length} Q&A records from CSV`);
    } catch (error) {
      this.logger.error(`Failed to load FFV CSV data: ${error.message}`);
      this.qaRecords = [];
    }
  }

  /**
   * Parse CSV content into Q&A records
   */
  private parseCSV(content: string): FFVQARecord[] {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];

    const records: FFVQARecord[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length >= 3) {
        records.push({
          question: values[0].replace(/^"|"$/g, '').trim(),
          shortAnswer: values[1].replace(/^"|"$/g, '').trim(),
          bigAnswer: values[2].replace(/^"|"$/g, '').trim(),
        });
      }
    }

    return records;
  }

  /**
   * Parse a single CSV line handling quoted values with commas
   */
  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);

    return result;
  }

  /**
   * Find a matching Q&A record for the given question
   * Uses simple text matching (case-insensitive, exact or close match)
   */
  findMatchingQA(userQuestion: string): FFVQAResult {
    if (this.qaRecords.length === 0) {
      return { found: false };
    }

    const normalizedQuestion = userQuestion.toLowerCase().trim();

    // Skip very short inputs (likely greetings like "hi", "hello", "ok")
    if (normalizedQuestion.length < 10) {
      return { found: false };
    }

    // Try exact match first
    for (const record of this.qaRecords) {
      if (record.question.toLowerCase().trim() === normalizedQuestion) {
        return this.createResult(record);
      }
    }

    // Try partial match - user question contains the record question
    for (const record of this.qaRecords) {
      const normalizedRecordQuestion = record.question.toLowerCase().trim();
      
      // User question should contain at least 60% of record question words
      const recordWords = normalizedRecordQuestion.split(/\s+/).filter(w => w.length > 2);
      const matchCount = recordWords.filter(w => normalizedQuestion.includes(w)).length;
      
      if (recordWords.length > 0 && matchCount >= recordWords.length * 0.6) {
        return this.createResult(record);
      }
    }

    return { found: false };
  }

  /**
   * Get Q&A record by question ID
   */
  getByQuestionId(questionId: string): FFVQAResult {
    const record = this.questionIdMap.get(questionId);
    if (!record) {
      return { found: false };
    }
    return this.createResult(record);
  }

  /**
   * Create a result object from a Q&A record
   */
  private createResult(record: FFVQARecord): FFVQAResult {
    // Find the question ID for this record
    let questionId = '';
    for (const [id, rec] of this.questionIdMap.entries()) {
      if (rec === record) {
        questionId = id;
        break;
      }
    }

    return {
      found: true,
      shortAnswer: record.shortAnswer,
      bigAnswer: record.bigAnswer,
      questionId,
    };
  }

  /**
   * Check if FFV is enabled and has data
   */
  isEnabled(): boolean {
    return this.qaRecords.length > 0;
  }

  /**
   * Get total number of Q&A records
   */
  getRecordCount(): number {
    return this.qaRecords.length;
  }

  /**
   * Set the last question ID for a phone number (for "more" flow)
   */
  setLastQuestionId(phoneNumber: string, questionId: string): void {
    this.lastQuestionMap.set(phoneNumber, questionId);
  }

  /**
   * Get the last question ID for a phone number
   */
  getLastQuestionId(phoneNumber: string): string | undefined {
    return this.lastQuestionMap.get(phoneNumber);
  }

  /**
   * Reload CSV data (useful for updating content without restart)
   */
  async reloadData(): Promise<void> {
    await this.loadCSVData();
  }
}