import { Injectable, Logger } from '@nestjs/common';

interface ScriptCount {
  script: string;
  count: number;
}

/** Detects the dominant Indian script used in text. */
@Injectable()
export class ScriptDetectionService {
  private readonly logger = new Logger(ScriptDetectionService.name);

  private readonly scriptRanges: { script: string; ranges: RegExp[] }[] = [
    { script: 'Devanagari', ranges: [/[ऀ-ॿ]/] },
    { script: 'Bengali-Assamese', ranges: [/[ঀ-৿]/] },
    { script: 'Gurmukhi', ranges: [/[਀-੿]/] },
    { script: 'Gujarati', ranges: [/[઀-૿]/] },
    { script: 'Odia', ranges: [/[଀-୿]/] },
    { script: 'Tamil', ranges: [/[஀-௿]/] },
    { script: 'Telugu', ranges: [/[ఀ-౿]/] },
    { script: 'Kannada', ranges: [/[ಀ-೿]/] },
    { script: 'Malayalam', ranges: [/[ഀ-෿]/] },
    {
      script: 'Perso-Arabic',
      ranges: [/[؀-ۿ]/, /[ݐ-ݿ]/, /[ࢠ-ࣿ]/],
    },
    { script: 'Ol Chiki', ranges: [/[᱐-᱿]/] },
    { script: 'Meitei Mayek', ranges: [/[ꯀ-꯿]/, /[ꫠ-꫿]/] },
  ];

  /**
   * Returns the script with the greatest number of matching characters.
   * Latin and empty input deliberately resolve to English, the configured fallback.
   */
  detect_script(text: string): string {
    if (!text?.trim()) return 'English';

    const scriptCounts: ScriptCount[] = [];
    for (const { script, ranges } of this.scriptRanges) {
      const count = ranges.reduce((total, range) => {
        const matches = text.match(new RegExp(range, 'g'));
        return total + (matches?.length ?? 0);
      }, 0);
      if (count > 0) scriptCounts.push({ script, count });
    }

    if (scriptCounts.length === 0) return 'English';

    scriptCounts.sort((a, b) => b.count - a.count);
    this.logger.debug(
      `Script detection: ${scriptCounts.map(({ script, count }) => `${script}:${count}`).join(', ')}`,
    );
    return scriptCounts[0].script;
  }
}
