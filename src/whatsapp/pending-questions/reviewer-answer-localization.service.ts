import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

/**
 * Localizes the English expert-review WhatsApp copy using Anthropic Claude Sonnet
 * so the user sees the notification in the same language as their question (when not English).
 */
@Injectable()
export class ReviewerAnswerLocalizationService implements OnModuleInit {
  private readonly logger = new Logger(ReviewerAnswerLocalizationService.name);
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY ?? '';
    this.model =
      process.env.ANTHROPIC_REVIEW_ANSWER_MODEL ?? 'claude-sonnet-4-5-20250929';
  }

  onModuleInit(): void {
    if (!this.apiKey) {
      this.logger.warn(
        'ANTHROPIC_API_KEY is not set — reviewer answers will stay in English.',
      );
    } else {
      this.logger.log(
        `Reviewer answer localization enabled — model=${this.model}`,
      );
    }
  }

  /**
   * Returns englishMessage unchanged if no API key, on error, or when the model
   * determines the user question is already English.
   */
  async localizeExpertWhatsAppMessage(params: {
    englishMessage: string;
    /** Raw or JSON-wrapped question text; used only to infer target language. */
    userQuestionText: string;
    /** BCP-47 from Sarvam STT when the question was voice (optional). */
    sttLanguageCode?: string | null;
  }): Promise<string> {
    const { englishMessage, userQuestionText, sttLanguageCode } = params;

    if (!this.apiKey?.trim() || !englishMessage.trim()) {
      return englishMessage;
    }

    const hint =
      typeof sttLanguageCode === 'string' && sttLanguageCode.trim()
        ? sttLanguageCode.trim()
        : 'none';

    const prompt = `You localize WhatsApp notifications for Indian farmers.

SPOKEN_LANGUAGE_HINT (BCP-47 from speech-to-text when the user asked by voice; "none" if text-only): ${hint}

USER_QUESTION (original wording; may be any language or script):
"""
${userQuestionText}
"""

ENGLISH_NOTIFICATION (keep identical factual content including expert answer, names, and URLs):
"""
${englishMessage}
"""

Rules:
1) Choose the output language: if SPOKEN_LANGUAGE_HINT is set and is not English (e.g. not en, en-US), treat that as the user's language. Otherwise infer the primary language from USER_QUESTION.
2) If the chosen language is English (user clearly asked in English), output ENGLISH_NOTIFICATION exactly unchanged.
3) Otherwise translate the entire ENGLISH_NOTIFICATION into that language. Preserve line breaks, emojis, and WhatsApp bold markers (*text*). Do not add or remove facts. Keep URLs unchanged.
4) Reply with ONLY the final message text — no quotes, no preamble.`;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 8192,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        this.logger.warn(
          `Anthropic localization failed: HTTP ${res.status} ${errBody.slice(0, 200)}`,
        );
        return englishMessage;
      }

      const data = (await res.json()) as {
        content?: { type: string; text?: string }[];
      };
      const text = data.content?.find((b) => b.type === 'text')?.text?.trim();
      if (!text) {
        this.logger.warn('Anthropic localization: empty content');
        return englishMessage;
      }

      return text;
    } catch (err: any) {
      this.logger.warn(
        `Anthropic localization error: ${err?.message ?? String(err)}`,
      );
      return englishMessage;
    }
  }
}
