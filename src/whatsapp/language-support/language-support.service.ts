import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface LanguagePair {
  scriptLanguage: string;
  vocalLanguage: string;
}

export interface ResolvedLanguagePair extends LanguagePair {
  detectedScript: string;
}

interface CatalogRow extends LanguagePair {
  twoHourDisclaimer: string;
  stateFollowUp: string;
  cropFollowUp: string;
  testingDisclaimer: string;
  lateNightDisclaimer: string;
  earlyMorningDisclaimer: string;
}

interface ScriptCount {
  script: string;
  count: number;
}

const OFFICIAL_LANGUAGES = [
  'Assamese',
  'Bengali',
  'Bodo',
  'Dogri',
  'Gujarati',
  'Hindi',
  'Kannada',
  'Kashmiri',
  'Konkani',
  'Maithili',
  'Malayalam',
  'Manipuri (Meitei)',
  'Marathi',
  'Nepali',
  'Odia',
  'Punjabi',
  'Sanskrit',
  'Santali',
  'Sindhi',
  'Tamil',
  'Telugu',
  'Urdu',
  'English',
];

const STT_LANGUAGE_MAP: Record<string, string> = {
  as: 'Assamese',
  bn: 'Bengali',
  brx: 'Bodo',
  doi: 'Dogri',
  gu: 'Gujarati',
  hi: 'Hindi',
  kn: 'Kannada',
  ks: 'Kashmiri',
  kok: 'Konkani',
  mai: 'Maithili',
  ml: 'Malayalam',
  mni: 'Manipuri (Meitei)',
  mr: 'Marathi',
  ne: 'Nepali',
  or: 'Odia',
  od: 'Odia',
  pa: 'Punjabi',
  sa: 'Sanskrit',
  sat: 'Santali',
  sd: 'Sindhi',
  ta: 'Tamil',
  te: 'Telugu',
  ur: 'Urdu',
  en: 'English',
};

const SCRIPT_TO_DEFAULT_VOCAL: Record<string, string> = {
  'Bengali-Assamese': 'Bengali',
  Devanagari: 'Hindi',
  Gujarati: 'Gujarati',
  Gurmukhi: 'Punjabi',
  Kannada: 'Kannada',
  Malayalam: 'Malayalam',
  'Meitei Mayek': 'Manipuri (Meitei)',
  Odia: 'Odia',
  'Ol Chiki': 'Santali',
  'Perso-Arabic': 'Urdu',
  Tamil: 'Tamil',
  Telugu: 'Telugu',
};

@Injectable()
export class LanguageSupportService implements OnModuleInit {
  private readonly logger = new Logger(LanguageSupportService.name);
  private readonly apiKey = process.env.LLM_API_KEY ?? '';
  private readonly model =
    process.env.LANGUAGE_DETECTION_MODEL ??
    process.env.ANTHROPIC_REVIEW_ANSWER_MODEL ??
    'claude-sonnet-4-5-20250929';
  private catalog = new Map<string, CatalogRow>();

  private readonly scriptRanges: { script: string; regex: RegExp }[] = [
    { script: 'Devanagari', regex: /[\u0900-\u097F]/g },
    { script: 'Bengali-Assamese', regex: /[\u0980-\u09FF]/g },
    { script: 'Gurmukhi', regex: /[\u0A00-\u0A7F]/g },
    { script: 'Gujarati', regex: /[\u0A80-\u0AFF]/g },
    { script: 'Odia', regex: /[\u0B00-\u0B7F]/g },
    { script: 'Tamil', regex: /[\u0B80-\u0BFF]/g },
    { script: 'Telugu', regex: /[\u0C00-\u0C7F]/g },
    { script: 'Kannada', regex: /[\u0C80-\u0CFF]/g },
    { script: 'Malayalam', regex: /[\u0D00-\u0DFF]/g },
    {
      script: 'Perso-Arabic',
      regex:
        /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g,
    },
    { script: 'Ol Chiki', regex: /[\u1C50-\u1C7F]/g },
    { script: 'Meitei Mayek', regex: /[\uABC0-\uABFF\uAAE0-\uAAFF]/g },
  ];

  onModuleInit(): void {
    this.loadCatalog();
  }

  detectScript(text: string): string {
    const value = text ?? '';
    const counts: ScriptCount[] = this.scriptRanges.map(({ script, regex }) => {
      const matches = value.match(regex);
      return { script, count: matches?.length ?? 0 };
    });
    const detected = counts.sort((a, b) => b.count - a.count)[0];
    return detected && detected.count > 0 ? detected.script : 'Latin';
  }

  detectScriptLanguage(text: string): string {
    const script = this.detectScript(text);
    return script === 'Latin' ? 'English' : script;
  }

  async resolveLanguagePair(
    text: string,
    options: { sttLanguageCode?: string | null } = {},
  ): Promise<ResolvedLanguagePair> {
    const detectedScript = this.detectScript(text);
    const scriptLanguage =
      detectedScript === 'Latin' ? 'English' : detectedScript;
    const vocalLanguage = await this.detectVocalLanguage(
      text,
      detectedScript,
      options.sttLanguageCode,
    );

    return {
      detectedScript,
      scriptLanguage,
      vocalLanguage,
    };
  }

  getTestingDisclaimer(pair: LanguagePair): string {
    return this.getCatalogRow(pair).testingDisclaimer;
  }

  getCatalogRow(pair: LanguagePair): CatalogRow {
    const script = this.normalizeName(pair.scriptLanguage) || 'English';
    const vocal = this.normalizeName(pair.vocalLanguage) || 'English';
    return (
      this.catalog.get(this.catalogKey(script, vocal)) ??
      this.catalog.get(this.catalogKey('English', 'English')) ??
      this.emptyEnglishRow()
    );
  }

  isEnglishPair(pair: LanguagePair): boolean {
    return (
      this.normalizeName(pair.scriptLanguage) === 'English' &&
      this.normalizeName(pair.vocalLanguage) === 'English'
    );
  }

  private async detectVocalLanguage(
    text: string,
    detectedScript: string,
    sttLanguageCode?: string | null,
  ): Promise<string> {
    const trimmed = (text ?? '').trim();
    if (!trimmed) return this.vocalFallback(detectedScript, sttLanguageCode);

    const llmDetected = await this.detectVocalLanguageWithLlm(trimmed);
    if (llmDetected) return llmDetected;

    return this.vocalFallback(detectedScript, sttLanguageCode);
  }

  private async detectVocalLanguageWithLlm(
    text: string,
  ): Promise<string | null> {
    if (!this.apiKey.trim()) return null;

    const prompt = `Analyze the following text from an Indian farmer and identify the underlying spoken language.

Examples:
- "What weather-related risks should I watch for over the next 7 days?" -> English
- "Mera sawal gehu ke baare me hai" -> Hindi

Hinglish/Hindi markers to look for (indicates Hindi, not English):
- Hindi postpositions: me, ke liye, se, ko, par
- Hindi verb forms: hai, hain, sakta hai, karna
- Hindi conjunctions: aur, ya, lekin, ki
- Hindi pronouns: mera, aap, hum, unka
- Hindi question words: kya, kahan, kab, kaise
- Hindi articles: ek

CRITICAL RULE:
- If the text uses standard English words, English prepositions (in, for, to, with, over, next), English verb forms (is, are, can, should, will, watch), and English grammar -> classify as ENGLISH
- If the text contains ANY of the Hindi markers above -> classify as the underlying Indian language
- NEVER classify as Hindi just because the text mentions Indian place names (Villupuram, Tamil Nadu), crop names (paddy, wheat), or state names - UNLESS the crop name itself is in Hindi (gehu, chawal, kanak)

CROP NAME RULE (apply ONLY if text is exactly a crop name, nothing else):
- English crop names: paddy, wheat, rice, maize, cotton, sugarcane, soybean, groundnut, potato, onion, tomato -> English
- Hindi crop names: gehu, chawal, makka, ganne, aloo, pyaz, tamatar, kanak -> Hindi
- For crop names in other Indian languages, use your judgment based on the word

LOCATION-ONLY RULE (apply ONLY if text is exactly a place name, nothing else):
- If text is only a state/district name in Latin script (Uttar Pradesh, Tamil Nadu, Villupuram, etc.) -> English
- If text is only a state/district name in Devanagari script (उत्तर प्रदेश, महाराष्ट्र, etc.) -> Hindi
- If text is only a state/district name in other native scripts -> the corresponding language

Return language from this EXACT list only:
${OFFICIAL_LANGUAGES.join(', ')}.

Return ONLY the language name. Do not include any other text, reasoning, or punctuation.

Text: ${text}
Language:`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 32,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        this.logger.warn(
          `Vocal language detection failed: HTTP ${response.status} ${errBody.slice(0, 160)}`,
        );
        return null;
      }

      const data = (await response.json()) as {
        content?: { type: string; text?: string }[];
      };
      const raw = data.content?.find((block) => block.type === 'text')?.text;
      return this.coerceOfficialLanguage(raw ?? '');
    } catch (err: any) {
      this.logger.warn(
        `Vocal language detection error: ${err?.message ?? String(err)}`,
      );
      return null;
    }
  }

  private vocalFallback(
    detectedScript: string,
    sttLanguageCode?: string | null,
  ): string {
    const fromStt = this.languageFromSttCode(sttLanguageCode);
    if (fromStt && fromStt !== 'English') return fromStt;

    if (detectedScript !== 'Latin') {
      return SCRIPT_TO_DEFAULT_VOCAL[detectedScript] ?? fromStt ?? 'English';
    }

    return fromStt ?? 'English';
  }

  private languageFromSttCode(code: string | null | undefined): string | null {
    const normalized = (code ?? '').trim().toLowerCase();
    if (!normalized) return null;
    const primary = normalized.split('-')[0];
    return (
      this.coerceOfficialLanguage(STT_LANGUAGE_MAP[normalized] ?? '') ??
      this.coerceOfficialLanguage(STT_LANGUAGE_MAP[primary] ?? '')
    );
  }

  private coerceOfficialLanguage(name: string): string | null {
    const lower = (name ?? '').trim().toLowerCase();
    if (!lower) return null;
    return (
      OFFICIAL_LANGUAGES.find((lang) => lang.toLowerCase() === lower) ??
      OFFICIAL_LANGUAGES.find((lang) =>
        new RegExp(`\\b${this.escapeRegExp(lang.toLowerCase())}\\b`, 'i').test(
          lower,
        ),
      ) ??
      null
    );
  }

  private loadCatalog(): void {
    const possiblePaths = [
      path.join(__dirname, 'translated-language-catalog.json'),
      path.join(
        process.cwd(),
        'src',
        'whatsapp',
        'language-support',
        'translated-language-catalog.json',
      ),
      path.join(
        process.cwd(),
        'dist',
        'whatsapp',
        'language-support',
        'translated-language-catalog.json',
      ),
    ];

    for (const catalogPath of possiblePaths) {
      if (!fs.existsSync(catalogPath)) continue;
      const rows = JSON.parse(
        fs.readFileSync(catalogPath, 'utf-8'),
      ) as CatalogRow[];
      for (const row of rows) {
        this.catalog.set(
          this.catalogKey(row.scriptLanguage, row.vocalLanguage),
          row,
        );
      }
      this.logger.log(
        `Loaded ${this.catalog.size} language catalog rows from ${catalogPath}`,
      );
      return;
    }

    this.logger.warn('Language catalog not found; using English fallback row');
    const fallback = this.emptyEnglishRow();
    this.catalog.set(this.catalogKey('English', 'English'), fallback);
  }

  private catalogKey(scriptLanguage: string, vocalLanguage: string): string {
    return `${this.normalizeName(scriptLanguage).toLowerCase()}::${this.normalizeName(vocalLanguage).toLowerCase()}`;
  }

  private normalizeName(name: string): string {
    return (name ?? '').trim();
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private emptyEnglishRow(): CatalogRow {
    return {
      scriptLanguage: 'English',
      vocalLanguage: 'English',
      twoHourDisclaimer: '',
      stateFollowUp: '',
      cropFollowUp: '',
      testingDisclaimer: '',
      lateNightDisclaimer: '',
      earlyMorningDisclaimer: '',
    };
  }
}
