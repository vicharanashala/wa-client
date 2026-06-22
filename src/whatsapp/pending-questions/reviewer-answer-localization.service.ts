import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export type ReviewerSource = { source: string; page?: string | null; sourceName?: string | null };

/**
 * Localizes reviewer WhatsApp notifications so labels AND the expert answer body
 * match the language of the user's original question.
 * Disclaimer is loaded from CSV and appended after LLM translation.
 */
@Injectable()
export class ReviewerAnswerLocalizationService implements OnModuleInit {
  private readonly logger = new Logger(ReviewerAnswerLocalizationService.name);
  private readonly apiKey: string;
  private readonly model: string;

  /** Map of script name -> disclaimer text from CSV */
  private disclaimerMap: Map<string, string> = new Map();

  constructor() {
    this.apiKey = process.env.LLM_API_KEY ?? '';
    this.model =
      process.env.ANTHROPIC_REVIEW_ANSWER_MODEL ?? 'claude-sonnet-4-5-20250929';
  }

  onModuleInit(): void {
    this.loadDisclaimerTranslations();

    if (!this.apiKey) {
      this.logger.warn(
        'LLM_API_KEY is not set — reviewer answers will stay in English.',
      );
    } else {
      this.logger.log(
        `Reviewer answer localization enabled — model=${this.model}`,
      );
    }
  }

  /**
   * Loads disclaimer translations from JSON file.
   */
  private loadDisclaimerTranslations(): void {
    // Use process.cwd() for reliable path resolution in both dev and production
    const jsonPath = path.join(process.cwd(), 'src', 'whatsapp', 'pending-questions', 'disclaimer-translations.json');
    try {
      const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
      const translations = JSON.parse(jsonContent) as Record<string, string>;
      
      for (const [scriptName, disclaimerText] of Object.entries(translations)) {
        if (!scriptName || !disclaimerText) continue;
        this.disclaimerMap.set(scriptName, disclaimerText);
        this.logger.debug(`Loaded disclaimer for: ${scriptName} (${disclaimerText.length} chars)`);
      }

      this.logger.log(
        `Loaded ${this.disclaimerMap.size} disclaimer translations from JSON`,
      );
    } catch (err: any) {
      this.logger.warn(
        `Failed to load disclaimer translations: ${err.message}. Using built-in defaults.`,
      );
      this.loadDefaultDisclaimers();
    }
  }

  /**
   * Fallback default disclaimers if CSV fails to load.
   */
  private loadDefaultDisclaimers(): void {
    this.disclaimerMap.set('English', this.getEnglishDisclaimer());
    this.disclaimerMap.set('Devanagari', this.getHindiDisclaimer());
  }

  /**
   * Gets disclaimer text for a given language code.
   */
  private getDisclaimerForLanguage(languageCode: string): string {
    const scriptName = this.languageCodeToScriptName(languageCode);
    return this.disclaimerMap.get(scriptName) ?? this.disclaimerMap.get('English') ?? '';
  }

  /**
   * Maps language code to CSV script name.
   * Must match exact script names in disclaimer-translations.csv
   */
  private languageCodeToScriptName(code: string): string {
    const map: Record<string, string> = {
      // Devanagari scripts (Hindi, Marathi, Nepali)
      hi: 'Devanagari',
      'hi-in': 'Devanagari',
      mr: 'Devanagari',
      ne: 'Devanagari',
      // Gurmukhi (Punjabi)
      pa: 'Gurmukhi',
      'pa-in': 'Gurmukhi',
      // Bengali-Assamese
      bn: 'Bengali-Assamese',
      'bn-in': 'Bengali-Assamese',
      // Tamil
      ta: 'Tamil',
      'ta-in': 'Tamil',
      // Telugu
      te: 'Telugu',
      'te-in': 'Telugu',
      // Kannada
      kn: 'Kannada',
      'kn-in': 'Kannada',
      // Malayalam
      ml: 'Malayalam',
      'ml-in': 'Malayalam',
      // Odia
      or: 'Odia',
      'or-in': 'Odia',
      // Gujarati
      gu: 'Gujarati',
      'gu-in': 'Gujarati',
      // English
      en: 'English',
      'en-in': 'English',
    };
    return map[code.toLowerCase()] ?? map[code.split('-')[0].toLowerCase()] ?? 'English';
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
    const targetLanguage = this.resolveTargetLanguage(questionText, sttLanguageCode);

    // For English, use formatEnglishNotification with CSV disclaimer
    if (this.isLikelyEnglishQuestion(questionText) || this.isEnglishLanguageCode(sttLanguageCode)) {
      this.logger.debug(
        `Skipping reviewer-answer translation — question appears to be English: "${questionText.slice(0, 80)}"`,
      );
      return this.formatLocalizedNotification(
        questionText,
        expertAnswer,
        author,
        sources,
        targetLanguage,
      );
    }

    if (!this.apiKey?.trim()) {
      return this.formatLocalizedNotification(
        questionText,
        expertAnswer,
        author,
        sources,
        targetLanguage,
      );
    }

    const authorName = author?.trim() || 'Expert';
    const sourceLines =
      sources && sources.length > 0
        ? sources.map((s) => s.sourceName ? `🔗${s.sourceName}: ${s.source}` : `🔗 ${s.source}`).join('\n')
        : '🔗 No sources provided.';

    // LLM prompt WITHOUT disclaimer items (removed - will be appended from CSV)
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
10) END your response here. The disclaimer will be automatically appended from the CSV file. Do NOT include any disclaimer text.

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
        return this.formatLocalizedNotification(
          questionText,
          expertAnswer,
          author,
          sources,
          targetLanguage,
        );
      }

      const data = (await res.json()) as {
        content?: { type: string; text?: string }[];
      };
      let translatedText = data.content?.find((b) => b.type === 'text')?.text?.trim();
      if (!translatedText) {
        this.logger.warn('Anthropic localization: empty content');
        return this.formatLocalizedNotification(
          questionText,
          expertAnswer,
          author,
          sources,
          targetLanguage,
        );
      }

      // Append disclaimer from CSV
      const disclaimer = this.getDisclaimerForLanguage(targetLanguage.code);
      if (disclaimer) {
        translatedText = translatedText + '\n\n' + disclaimer;
      }

      this.logger.debug(
        `Localized reviewer notification to ${targetLanguage.name} for question "${questionText.slice(0, 40)}…"`,
      );
      return translatedText;
    } catch (err: any) {
      this.logger.warn(
        `Anthropic localization error: ${err?.message ?? String(err)}`,
      );
      return this.formatLocalizedNotification(
        questionText,
        expertAnswer,
        author,
        sources,
        targetLanguage,
      );
    }
  }

  /**
   * Formats notification with disclaimer from CSV.
   */
  private formatLocalizedNotification(
    questionText: string,
    answer: string,
    author?: string,
    sources?: ReviewerSource[],
    targetLanguage?: { name: string; code: string },
  ): string {
    const authorName = author?.trim() || 'Expert';
    const sourceLinks =
      sources && sources.length > 0
        ? sources.map((s) => s.sourceName ? `🔗${s.sourceName}: ${s.source}` : `🔗 ${s.source}`)
        : ['No sources provided.'];

    const langCode = targetLanguage?.code ?? 'en';
    const disclaimer = this.getDisclaimerForLanguage(langCode);

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
      disclaimer,
    ].join('\n');
  }

  /**
   * Legacy method kept for backward compatibility.
   * @deprecated Use formatLocalizedNotification instead.
   */
  formatEnglishNotification(
    questionText: string,
    answer: string,
    author?: string,
    sources?: ReviewerSource[],
  ): string {
    return this.formatLocalizedNotification(questionText, answer, author, sources, {
      name: 'English',
      code: 'en',
    });
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
    // Check for English first
    if (this.isLikelyEnglishQuestion(questionText) || this.isEnglishLanguageCode(sttLanguageCode)) {
      return { name: 'English', code: 'en' };
    }

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

  // Default disclaimer getters (fallback if CSV fails)
  private getEnglishDisclaimer(): string {
    return `⚠️ Important Notice (Testing) ⚠️

This AjraSakha application is under development and intended only for testing and validation.
Advisories are experimental and currently cover major crops in selected states.
_____________________________

Weather data is sourced from IMD.
Market data from eNAM, Agmarknet, and State APMCs.
Soil health guidance from https://soilhealth.dac.gov.in/fertilizer-dosage.
Government schemes from https://www.myscheme.gov.in/. 
Other agricultural information and advisories are expert-verified by Annam.ai. 

Users should independently validate recommendations before acting.`;
  }

  private getHindiDisclaimer(): string {
    return `⚠️ महत्वपूर्ण सूचना (परीक्षण) ⚠️

यह AjraSakha एप्लिकेशन विकास के अधीन है और केवल परीक्षण और सत्यापन के लिए है।
सलाहें प्रयोगात्मक हैं और वर्तमान में चुनिंदा राज्यों में प्रमुख फसलों को कवर करती हैं।
_____________________________

मौसम डेटा IMD से लिया गया है।
बाजार डेटा eNAM, Agmarknet और राज्य APMCs से लिया गया है।
मृदा स्वास्थ्य मार्गदर्शन https://soilhealth.dac.gov.in/fertilizer-dosage से लिया गया है।
सरकारी योजनाएं https://www.myscheme.gov.in/ से ली गई हैं।
अन्य कृषि जानकारी और सलाहें Annam.ai द्वारा विशेषज्ञ-सत्यापित हैं।

उपयोगकर्ताओं को कार्य करने से पहले सिफारिशों को स्वतंत्र रूप से सत्यापित करना चाहिए।`;
  }
}