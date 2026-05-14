import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PendingQuestionRepository } from './pending-question.repository';
import { WhatsappService } from '../whatsapp-api/whatsapp.service';

// Define a type for the reviewer result to keep our signatures clean
type ReviewerStatusResult = {
  status: string;
  answer?: string;
  author?: string;
  sources?: { source: string; page?: string | null }[];
};

/**
 * Polls the reviewer system on a cron schedule (default: every 2 hours)
 * to check if pending questions have been answered by human experts.
 *
 * When an answer is found, it auto-sends a notification message to the user
 * on WhatsApp and marks the question as notified.
 *
 * Cron schedule can be customised via the REVIEWER_CRON_EXPRESSION env var.
 * Default: "0 *​/2 * * *"  (every 2 hours, on the hour).
 */
@Injectable()
export class ReviewerPollingService implements OnModuleInit {
  private readonly logger = new Logger(ReviewerPollingService.name);

  /** Reviewer system REST API base URL (for checking question status) */
  private readonly reviewerApiBaseUrl: string;

  /** Internal API key for authenticating with the reviewer system */
  private readonly reviewerApiKey: string;

  constructor(
    private readonly pendingQuestionRepo: PendingQuestionRepository,
    private readonly whatsappService: WhatsappService,
  ) {
    this.reviewerApiBaseUrl =
      process.env.REVIEWER_API_BASE_URL || 'https://desk.vicharanashala.ai/api';
    this.reviewerApiKey = process.env.REVIEWER_INTERNAL_API_KEY || '';
  }

  onModuleInit(): void {
    const cronExpr =
      process.env.REVIEWER_CRON_EXPRESSION || CronExpression.EVERY_2_HOURS;
    this.logger.log(
      `🕐 Reviewer polling cron job ACTIVE — schedule: "${cronExpr}"`,
    );
    this.logger.log(
      `🔗 Reviewer API base URL: ${this.reviewerApiBaseUrl}`,
    );
  }

  /**
   * Cron-scheduled polling job.
   * Runs every 2 hours by default (CronExpression.EVERY_2_HOURS).
   * Override with env var REVIEWER_CRON_EXPRESSION if needed.
   */
  @Cron(process.env.REVIEWER_CRON_EXPRESSION || CronExpression.EVERY_2_HOURS, {
    name: 'reviewer-polling',
  })
  async handleCron(): Promise<void> {
    this.logger.log('🔄 Cron triggered: checking reviewer system for answers…');
    try {
      await this.pollReviewerSystem();
    } catch (err: any) {
      this.logger.error(`Poll cycle failed: ${err.message}`);
    }
  }

  /**
   * Core polling routine:
   * 1. Fetch all pending questions from MongoDB
   * 2. Check their status against the reviewer system API
   * 3. For any answered question, send the answer to the user and mark as notified
   */
  async pollReviewerSystem(): Promise<void> {
    const pendingQuestions = await this.pendingQuestionRepo.findAllPending();

    if (pendingQuestions.length === 0) {
      this.logger.debug('No pending questions to check');
      return;
    }

    this.logger.log(
      `🔍 Checking ${pendingQuestions.length} pending question(s) with reviewer system...`,
    );

    const questionIds = pendingQuestions.map((q) => q.questionId);

    // Try batch endpoint first; fall back to individual checks
    let statusMap: Map<string, ReviewerStatusResult>;

    try {
      statusMap = await this.batchCheckStatus(questionIds);
    } catch (batchErr: any) {
      this.logger.warn(
        `Batch status check failed (${batchErr.message}), falling back to individual checks`,
      );
      statusMap = await this.individualCheckStatus(questionIds);
    }

    // Process answered questions
    for (const question of pendingQuestions) {
      const result = statusMap.get(question.questionId);
      if (!result) continue;

      if (result.status === 'closed' && result.answer) {
        this.logger.log(
          `✅ Question ${question.questionId} answered! Notifying ${question.phoneNumber}`,
        );

        try {
          // Mark as answered in our DB
          await this.pendingQuestionRepo.markAnswered(
            question.questionId,
            result.answer,
          );

          // Send notification to user on WhatsApp
          const notificationMessage = this.formatNotification(
            question.queryText,
            result.answer,
            result.author,
            result.sources,
          );

          await this.whatsappService.sendTextMessage(
            question.phoneNumber,
            notificationMessage,
            question.originalMessageId ?? undefined,
          );

          // Mark as notified
          await this.pendingQuestionRepo.markNotified(question.questionId);

          this.logger.log(
            `📤 Notification sent to ${question.phoneNumber} for question ${question.questionId}`,
          );
        } catch (sendErr: any) {
          this.logger.error(
            `Failed to notify ${question.phoneNumber} for question ${question.questionId}: ${sendErr.message}`,
          );
          // Don't mark as notified — will retry on next poll cycle
        }
      }
    }
  }

  /**
   * Process an answer received via a real-time webhook instead of polling.
   */
  async processWebhookAnswer(payload: {
    question_id: string;
    status: string;
    answer?: string;
    author?: string;
    sources?: { source: string; page?: string | null }[];
  }): Promise<void> {
    const { question_id, status, answer, author, sources } = payload;
    
    if (status !== 'closed' || !answer) {
      this.logger.warn(`Webhook received for question ${question_id} but status is '${status}' or answer is missing`);
      return;
    }

    const question = await this.pendingQuestionRepo.findByQuestionId(question_id);
    if (!question) {
      this.logger.warn(`Webhook received for unknown question ID: ${question_id}`);
      return;
    }

    if (question.status === 'notified') {
      this.logger.log(`Question ${question_id} has already been answered and notified.`);
      return;
    }

    this.logger.log(`✅ Webhook received: Question ${question_id} answered! Notifying ${question.phoneNumber}`);

    try {
      // Mark as answered
      await this.pendingQuestionRepo.markAnswered(question_id, answer);

      // Send notification
      const notificationMessage = this.formatNotification(
        question.queryText,
        answer,
        author,
        sources,
      );

      await this.whatsappService.sendTextMessage(
        question.phoneNumber,
        notificationMessage,
        question.originalMessageId ?? undefined,
      );

      // Mark as notified
      await this.pendingQuestionRepo.markNotified(question_id);

      this.logger.log(`📤 Notification sent to ${question.phoneNumber} for question ${question_id}`);
    } catch (sendErr: any) {
      this.logger.error(
        `Failed to notify ${question.phoneNumber} for question ${question_id} via webhook: ${sendErr.message}`,
      );
    }
  }

  // ── Reviewer System API Calls ──────────────────────────────────────────

  /**
   * Batch check: POST /questions/check-status
   * Preferred approach — single HTTP call for all pending questions.
   */
  private async batchCheckStatus(
    questionIds: string[],
  ): Promise<Map<string, ReviewerStatusResult>> {
    const url = `${this.reviewerApiBaseUrl}/questions/check-status`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': this.reviewerApiKey,
      },
      body: JSON.stringify({ question_ids: questionIds }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Batch check failed (${response.status}): ${errorText}`);
    }

    const body = (await response.json()) as {
      success: boolean;
      data: {
        question_id: string;
        status: string;
        answer?: string | null;
        sources?: { source: string; page?: string | null }[];
        author?: string | null;
      }[];
    };

    const map = new Map<string, ReviewerStatusResult>();
    for (const r of body.data) {
      map.set(r.question_id, {
        status: r.status,
        answer: r.answer ?? undefined,
        author: r.author ?? undefined,
        sources: r.sources ?? undefined,
      });
    }
    return map;
  }

  /**
   * Individual check: GET /questions/{id}/status
   * Fallback when batch endpoint is not available.
   */
  private async individualCheckStatus(
    questionIds: string[],
  ): Promise<Map<string, ReviewerStatusResult>> {
    const map = new Map<string, ReviewerStatusResult>();

    for (const id of questionIds) {
      try {
        const url = `${this.reviewerApiBaseUrl}/questions/${id}/status`;
        const response = await fetch(url, {
          headers: { 'x-internal-api-key': this.reviewerApiKey },
        });

        if (!response.ok) {
          this.logger.warn(
            `Status check for ${id} failed (${response.status})`,
          );
          continue;
        }

        const data = (await response.json()) as ReviewerStatusResult;
        map.set(id, data);
      } catch (err: any) {
        this.logger.warn(`Status check for ${id} errored: ${err.message}`);
      }
    }

    return map;
  }

  // ── Notification Formatting ────────────────────────────────────────────

  /**
   * Formats the WhatsApp notification message that gets sent when an
   * expert answer becomes available.
   */
  private formatNotification(
    queryText: string,
    answer: string,
    author?: string,
    sources?: { source: string; page?: string | null }[],
  ): string {
    let parsedQuestion = queryText;
    try {
      const parsedData = JSON.parse(queryText);
      if (parsedData && parsedData.question) {
        parsedQuestion = parsedData.question;
      }
    } catch (err) {
    }

    const authorName = author || 'Expert';
    const sourceLinks =
      sources && sources.length > 0
        ? sources.map((s) => `🔗 ${s.source}`)
        : ['No sources provided.'];

    return [
      `✅ *Your question has been reviewed by an expert!*`,
      ``,
      `📌 *Your Question:*`,
      `"${parsedQuestion}"`,
      ``,
      `💡 *Expert Answer:*`,
      answer,
      ``,
      `👤 *Answered by:* ${authorName}`,
      ``,
      `📚 *Sources:*`,
      ...sourceLinks,
      ``,
      `⚠️ This is a testing version. Please consult an expert before making farming decisions.`,
    ].join('\n');
  }
}