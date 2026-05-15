import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

export type ReviewerSource = { source: string; page?: string | null };

/**
 * Localizes reviewer WhatsApp notifications so labels AND the expert answer body
 * match the language of the user's original question.
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
   * Builds the full WhatsApp notification in the user's language.
   */
  async localizeExpertWhatsAppNotification(params: {
    userQuestionText: string;
    expertAnswer: string;
    author?: string;
    sources?: ReviewerSource[];
    sttLanguageCode?: string | null;
  }): Promise<string> {
    const {
      userQuestionText,
      expertAnswer,
      author,
      sources,
      sttLanguageCode,
    } = params;

    const questionText = this.extractQuestionText(userQuestionText);
    const englishNotification = this.formatEnglishNotification(
      questionText,
      expertAnswer,
      author,
      sources,
    );

    if (!this.apiKey?.trim()) {
      return englishNotification;
    }

    if (this.isLikelyEnglishQuestion(questionText)) {
      this.logger.debug(
        `Skipping reviewer-answer translation — question appears to be English: "${questionText.slice(0, 80)}"`,
      );
      return englishNotification;
    }

    if (this.isEnglishLanguageCode(sttLanguageCode)) {
      this.logger.debug(
        `Skipping reviewer-answer translation — STT language is English (${sttLanguageCode})`,
      );
      return englishNotification;
    }

    const targetLanguage = this.resolveTargetLanguage(
      questionText,
      sttLanguageCode,
    );
    const authorName = author?.trim() || 'Expert';
    const sourceLines =
      sources && sources.length > 0
        ? sources.map((s) => `🔗 ${s.source}`).join('\n')
        : '🔗 No sources provided.';

    const prompt = `You write a single WhatsApp notification for an Indian farmer.

TARGET_LANGUAGE: ${targetLanguage.name} (${targetLanguage.code})
Use ${targetLanguage.name} for every label AND for the entire expert answer body. The farmer must not see English in the expert answer section unless the answer is only URLs or proper nouns.

USER_QUESTION (already in the user's language — copy verbatim inside quotes; do not re-translate):
"""
${questionText}
"""

EXPERT_ANSWER_FROM_REVIEWER (written in ENGLISH by the expert desk — translate 100% of this text into ${targetLanguage.name}, line by line, preserving meaning and line breaks):
"""
${expertAnswer}
"""

AUTHOR_NAME (keep exactly as written): ${authorName}

SOURCE_LINES (translate descriptive text to ${targetLanguage.name} if it is English; keep 🔗 and URLs unchanged):
${sourceLines}

OUTPUT STRUCTURE (all section titles/labels in ${targetLanguage.name}):
1) Opening line with ✅ and bold title — meaning: "Your question has been reviewed by an expert!"
2) Blank line
3) 📌 bold label for "Your Question:" then the question in quotes on the next line(s)
4) Blank line
5) 💡 bold label for "Expert Answer:" then the FULL translated expert answer (NOT English)
6) Blank line
7) 👤 bold label for "Answered by:" then AUTHOR_NAME
8) Blank line
9) 📚 bold label for "Sources:" then SOURCE_LINES (localized)
10) Blank line
11) ⚠️ disclaimer — meaning: "This is a testing version. Please consult an expert before making farming decisions."

RULES:
- Do NOT use state names (Punjab, Tamil Nadu, etc.) to pick language — only USER_QUESTION script/language and TARGET_LANGUAGE above.
- The Expert Answer section is mandatory to translate fully into ${targetLanguage.name}, even if it looks like placeholder text (e.g. "test test").
- Preserve WhatsApp bold markers like *text*.
- Preserve emojis (✅ 📌 💡 👤 📚 ⚠️ 🔗).
- Do not add or remove facts.
- Reply with ONLY the final WhatsApp message — no JSON, no preamble, no markdown code fences.`;

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
        return englishNotification;
      }

      const data = (await res.json()) as {
        content?: { type: string; text?: string }[];
      };
      const text = data.content?.find((b) => b.type === 'text')?.text?.trim();
      if (!text) {
        this.logger.warn('Anthropic localization: empty content');
        return englishNotification;
      }

      this.logger.debug(
        `Localized reviewer notification to ${targetLanguage.name} for question "${questionText.slice(0, 40)}…"`,
      );
      return text;
    } catch (err: any) {
      this.logger.warn(
        `Anthropic localization error: ${err?.message ?? String(err)}`,
      );
      return englishNotification;
    }
  }

  formatEnglishNotification(
    questionText: string,
    answer: string,
    author?: string,
    sources?: ReviewerSource[],
  ): string {
    const authorName = author?.trim() || 'Expert';
    const sourceLinks =
      sources && sources.length > 0
        ? sources.map((s) => `🔗 ${s.source}`)
        : ['No sources provided.'];

    return [
      `✅ *Your question has been reviewed by an expert!*`,
      ``,
      `📌 *Your Question:*`,
      `"${questionText}"`,
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

  private extractQuestionText(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return trimmed;
    try {
      const parsed = JSON.parse(trimmed) as { question?: string };
      if (parsed?.question && typeof parsed.question === 'string') {
        return parsed.question.trim();
      }
    } catch {
      // not JSON
    }
    return trimmed;
  }

  private isEnglishLanguageCode(code: string | null | undefined): boolean {
    if (!code?.trim()) return false;
    return /^en(-[a-z]{2,4})?$/i.test(code.trim());
  }

  private resolveTargetLanguage(
    questionText: string,
    sttLanguageCode?: string | null,
  ): { name: string; code: string } {
    const fromScript = this.languageFromScript(questionText);
    if (fromScript) return fromScript;

    const fromStt = this.languageFromSttCode(sttLanguageCode);
    if (fromStt) return fromStt;

    return { name: 'Hindi', code: 'hi' };
  }

  private languageFromScript(
    text: string,
  ): { name: string; code: string } | null {
    if (/[\u0B80-\u0BFF]/.test(text)) return { name: 'Tamil', code: 'ta' };
    if (/[\u0A00-\u0A7F]/.test(text)) return { name: 'Punjabi', code: 'pa' };
    if (/[\u0980-\u09FF]/.test(text)) return { name: 'Bengali', code: 'bn' };
    if (/[\u0C00-\u0C7F]/.test(text)) return { name: 'Telugu', code: 'te' };
    if (/[\u0C80-\u0CFF]/.test(text)) return { name: 'Kannada', code: 'kn' };
    if (/[\u0D00-\u0D7F]/.test(text)) return { name: 'Malayalam', code: 'ml' };
    if (/[\u0B00-\u0B7F]/.test(text)) return { name: 'Odia', code: 'or' };
    if (/[\u0A80-\u0AFF]/.test(text)) return { name: 'Gujarati', code: 'gu' };
    if (/[\u0900-\u097F]/.test(text)) return { name: 'Hindi', code: 'hi' };
    return null;
  }

  private languageFromSttCode(
    code: string | null | undefined,
  ): { name: string; code: string } | null {
    if (!code?.trim() || this.isEnglishLanguageCode(code)) return null;
    const c = code.trim().toLowerCase();
    const map: Record<string, { name: string; code: string }> = {
      hi: { name: 'Hindi', code: 'hi' },
      'hi-in': { name: 'Hindi', code: 'hi' },
      pa: { name: 'Punjabi', code: 'pa' },
      'pa-in': { name: 'Punjabi', code: 'pa' },
      ta: { name: 'Tamil', code: 'ta' },
      'ta-in': { name: 'Tamil', code: 'ta' },
      te: { name: 'Telugu', code: 'te' },
      kn: { name: 'Kannada', code: 'kn' },
      ml: { name: 'Malayalam', code: 'ml' },
      bn: { name: 'Bengali', code: 'bn' },
      mr: { name: 'Marathi', code: 'mr' },
      gu: { name: 'Gujarati', code: 'gu' },
      or: { name: 'Odia', code: 'or' },
    };
    return map[c] ?? map[c.split('-')[0]] ?? null;
  }

  private isLikelyEnglishQuestion(text: string): boolean {
    const t = text.trim();
    if (!t) return true;

    if (
      /[\u0900-\u097F\u0A00-\u0A7F\u0980-\u09FF\u0B80-\u0BFF\u0C00-\u0C7F\u0D00-\u0D7F]/.test(
        t,
      )
    ) {
      return false;
    }

    const lower = t.toLowerCase();
    const englishWordPattern =
      /\b(how|what|when|where|why|who|can|could|should|would|is|are|was|were|do|does|did|have|has|had|the|a|an|and|or|for|in|on|at|to|of|my|your|grow|growing|plant|crop|help|please|tell|about|best|way)\b/;
    if (englishWordPattern.test(lower)) {
      return true;
    }

    if (/^[\x20-\x7E\n\r\t'".,!?;:()\-–—%0-9]+$/.test(t)) {
      return true;
    }

    return false;
  }
}
