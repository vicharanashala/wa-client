import { Injectable, Logger } from '@nestjs/common';

export interface TranscribeResult {
  transcript: string;
  languageCode: string | null;
}

@Injectable()
export class SarvamService {
  private readonly logger = new Logger(SarvamService.name);
  private readonly apiKey =
    process.env.SARVAM_API_KEY! || '';
  private readonly baseUrl = 'https://api.sarvam.ai';

  // ── Speech to Text ─────────────────────────────────────────────────

  async transcribeToEnglish(
    audioBuffer: Buffer,
    mimeType: string,
  ): Promise<TranscribeResult> {
    const formData = new FormData();

    // @ts-ignore
    const blob = new Blob([audioBuffer], { type: mimeType });
    formData.append('file', blob, 'audio.ogg');
    formData.append('model', 'saaras:v3');
    formData.append('mode', 'codemix');
    formData.append('language_code', 'unknown');

    const response = await fetch(`${this.baseUrl}/speech-to-text`, {
      method: 'POST',
      headers: { 'api-subscription-key': this.apiKey },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Sarvam STT failed: ${error}`);
    }

    const data = (await response.json()) as {
      transcript: string;
      language_code: string | null;
    };

    this.logger.debug(
      `Transcribed [${data.language_code}]: "${data.transcript.slice(0, 60)}"`,
    );

    return {
      transcript: data.transcript,
      languageCode: data.language_code,
    };
  }

  // ── Text to Speech ─────────────────────────────────────────────────

  async synthesize(text: string, languageCode: string | null): Promise<Buffer> {
    const targetLanguage = this.mapToSarvamLanguage(languageCode);
    const chunks = this.chunkText(text, 2500);
    const audioBuffers: Buffer[] = [];

    for (const chunk of chunks) {
      const response = await fetch(`${this.baseUrl}/text-to-speech`, {
        method: 'POST',
        headers: {
          'api-subscription-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: chunk,
          target_language_code: targetLanguage,
          model: 'bulbul:v3',
          output_audio_codec: 'opus',
          speech_sample_rate: 16000,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Sarvam TTS failed: ${error}`);
      }

      const data = (await response.json()) as { audios: string[] };
      audioBuffers.push(Buffer.from(data.audios[0], 'base64'));
    }

    return Buffer.concat(audioBuffers);
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private chunkText(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text.trim();

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      let breakAt = remaining.lastIndexOf('.', maxLength);
      if (breakAt === -1) breakAt = remaining.lastIndexOf(' ', maxLength);
      if (breakAt === -1) breakAt = maxLength;

      chunks.push(remaining.slice(0, breakAt + 1).trim());
      remaining = remaining.slice(breakAt + 1).trim();
    }

    return chunks;
  }

  // ── Language Mapping ───────────────────────────────────────────────

  private mapToSarvamLanguage(bcp47Code: string | null): string {
    if (!bcp47Code) return 'hi-IN';

    const map: Record<string, string> = {
      'hi-IN': 'hi-IN',
      'te-IN': 'te-IN',
      'ta-IN': 'ta-IN',
      'mr-IN': 'mr-IN',
      'bn-IN': 'bn-IN',
      'gu-IN': 'gu-IN',
      'kn-IN': 'kn-IN',
      'ml-IN': 'ml-IN',
      'pa-IN': 'pa-IN',
      'od-IN': 'od-IN',
      'en-IN': 'en-IN',
    };

    return map[bcp47Code] ?? 'hi-IN';
  }
}
