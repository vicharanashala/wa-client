import { Injectable, Logger } from '@nestjs/common';

export interface TranscribeResult {
  transcript: string;
  languageCode: string | null;
}

/** Error thrown when audio exceeds the maximum allowed duration. */
export class AudioTooLongError extends Error {
  constructor(
    public readonly estimatedSeconds: number,
    public readonly maxSeconds: number,
  ) {
    super(
      `Audio is too long: estimated ${estimatedSeconds.toFixed(0)}s exceeds ${maxSeconds}s limit`,
    );
    this.name = 'AudioTooLongError';
  }
}

// ── Batch STT types ──────────────────────────────────────────────────

/** Maximum audio duration (seconds) allowed for transcription. */
const MAX_AUDIO_DURATION_SECONDS = 120; // 2 minutes
/** Threshold (seconds) above which we switch from sync to batch STT. */
const BATCH_STT_DURATION_THRESHOLD = 25;
/** Interval between status polls (ms). */
const BATCH_POLL_INTERVAL_MS = 3_000;
/** Maximum number of status polls before we give up (~3 minutes). */
const BATCH_MAX_POLLS = 60;

interface BatchInitResponse {
  job_id: string;
  job_state: string;
}

interface BatchUploadResponse {
  job_id: string;
  job_state: string;
  upload_urls: Record<string, { file_url: string }>;
}

interface BatchStatusResponse {
  job_state: string;
  job_id: string;
  total_files: number;
  successful_files_count: number;
  failed_files_count: number;
  error_message?: string;
  job_details?: Array<{
    inputs: Array<{ file_name: string; file_id: string }>;
    outputs: Array<{ file_name: string; file_id: string }>;
    state: string;
    error_message?: string | null;
  }>;
}

interface BatchDownloadResponse {
  job_id: string;
  job_state: string;
  download_urls: Record<string, { file_url: string }>;
}

@Injectable()
export class SarvamService {
  private readonly logger = new Logger(SarvamService.name);
  private readonly apiKey =
    process.env.SARVAM_API_KEY! || '';
  private readonly baseUrl = 'https://api.sarvam.ai';

  // ── Speech to Text ─────────────────────────────────────────────────

  /**
   * Transcribe audio to text. Automatically routes to the async batch
   * API when the audio is estimated to be longer than 25 seconds
   * (the sync endpoint hard-caps at 30 s).
   * 
   * Throws AudioTooLongError if audio exceeds MAX_AUDIO_DURATION_SECONDS (2 minutes).
   */
  async transcribeToEnglish(
    audioBuffer: Buffer,
    mimeType: string,
  ): Promise<TranscribeResult> {
    const estimatedDuration = this.estimateAudioDurationSeconds(
      audioBuffer,
      mimeType,
    );

    // Check if audio exceeds maximum allowed duration
    if (estimatedDuration > MAX_AUDIO_DURATION_SECONDS) {
      this.logger.warn(
        `Audio ~${estimatedDuration.toFixed(0)}s exceeds ${MAX_AUDIO_DURATION_SECONDS}s limit`,
      );
      throw new AudioTooLongError(estimatedDuration, MAX_AUDIO_DURATION_SECONDS);
    }

    if (estimatedDuration > BATCH_STT_DURATION_THRESHOLD) {
      this.logger.log(
        `Audio ~${estimatedDuration.toFixed(0)}s exceeds ${BATCH_STT_DURATION_THRESHOLD}s threshold — using batch STT`,
      );
      return this.transcribeBatch(audioBuffer, mimeType);
    }

    return this.transcribeSync(audioBuffer, mimeType);
  }

  // ── Sync STT (≤ 25 s) ─────────────────────────────────────────────

  private async transcribeSync(
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
      `Transcribed (sync) [${data.language_code}]: "${data.transcript.slice(0, 60)}"`,
    );

    return {
      transcript: data.transcript,
      languageCode: data.language_code,
    };
  }

  // ── Batch STT (> 25 s) ────────────────────────────────────────────

  /**
   * Full async batch pipeline:
   *   1. Initiate job  →  2. Get upload URL  →  3. Upload file
   *   →  4. Start job   →  5. Poll until done →  6. Download result
   */
  private async transcribeBatch(
    audioBuffer: Buffer,
    mimeType: string,
  ): Promise<TranscribeResult> {
    const fileName = 'audio.ogg';

    // ── Step 1: Initiate job ────────────────────────────────────────
    const initRes = await fetch(this.batchJobUrl(), {
      method: 'POST',
      headers: {
        'api-subscription-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        job_parameters: {
          model: 'saaras:v3',
          mode: 'codemix',
          language_code: 'unknown',
        },
      }),
    });

    if (!initRes.ok) {
      const err = await initRes.text();
      throw new Error(`Sarvam batch STT initiate failed: ${err}`);
    }

    const { job_id } = (await initRes.json()) as BatchInitResponse;
    this.logger.log(`Batch STT job initiated: ${job_id}`);

    // ── Step 2: Get presigned upload URL ────────────────────────────
    const uploadUrlRes = await fetch(
      this.batchJobUrl('/upload-files'),
      {
        method: 'POST',
        headers: {
          'api-subscription-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ job_id, files: [fileName] }),
      },
    );

    if (!uploadUrlRes.ok) {
      const err = await uploadUrlRes.text();
      throw new Error(`Sarvam batch STT upload-url failed: ${err}`);
    }

    const uploadData = (await uploadUrlRes.json()) as BatchUploadResponse;
    const uploadEntry = uploadData.upload_urls[fileName];
    if (!uploadEntry?.file_url) {
      throw new Error(
        `Sarvam batch STT: no upload URL returned for "${fileName}"`,
      );
    }

    // ── Step 3: Upload audio to presigned URL ───────────────────────
    const uploadRes = await fetch(uploadEntry.file_url, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType || 'audio/ogg',
        'x-ms-blob-type': 'BlockBlob',
      },
      body: new Uint8Array(audioBuffer),
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`Sarvam batch STT file upload failed: ${err}`);
    }
    this.logger.debug(`Batch STT: file uploaded (${audioBuffer.length} bytes)`);

    // ── Step 4: Start job ───────────────────────────────────────────
    const startRes = await fetch(
      this.batchJobUrl(`/${job_id}/start`),
      {
        method: 'POST',
        headers: {
          'api-subscription-key': this.apiKey,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!startRes.ok) {
      const err = await startRes.text();
      throw new Error(`Sarvam batch STT start failed: ${err}`);
    }
    this.logger.debug(`Batch STT: job ${job_id} started`);

    // ── Step 5: Poll until completed ────────────────────────────────
    const status = await this.pollJobUntilDone(job_id);

    if (status.job_state === 'Failed') {
      throw new Error(
        `Sarvam batch STT job failed: ${status.error_message || 'unknown error'}`,
      );
    }

    // Collect output file names from job_details
    const outputFiles: string[] = [];
    for (const detail of status.job_details ?? []) {
      if (detail.state === 'Success') {
        for (const out of detail.outputs ?? []) {
          outputFiles.push(out.file_name);
        }
      }
    }

    if (outputFiles.length === 0) {
      throw new Error('Sarvam batch STT: no output files in completed job');
    }

    // ── Step 6: Download result ─────────────────────────────────────
    const dlRes = await fetch(
      this.batchJobUrl('/download-files'),
      {
        method: 'POST',
        headers: {
          'api-subscription-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ job_id, files: outputFiles }),
      },
    );

    if (!dlRes.ok) {
      const err = await dlRes.text();
      throw new Error(`Sarvam batch STT download-url failed: ${err}`);
    }

    const dlData = (await dlRes.json()) as BatchDownloadResponse;

    // Download the first output file
    const firstFile = outputFiles[0];
    const dlEntry = dlData.download_urls[firstFile];
    if (!dlEntry?.file_url) {
      throw new Error(
        `Sarvam batch STT: no download URL for "${firstFile}"`,
      );
    }

    const transcriptRes = await fetch(dlEntry.file_url);
    if (!transcriptRes.ok) {
      const err = await transcriptRes.text();
      throw new Error(`Sarvam batch STT transcript download failed: ${err}`);
    }

    const transcriptData = (await transcriptRes.json()) as {
      transcript?: string;
      language_code?: string | null;
      // The batch output may wrap in different structures; handle common shapes
      text?: string;
      lang?: string;
    };

    const transcript =
      transcriptData.transcript ?? transcriptData.text ?? '';
    const languageCode =
      transcriptData.language_code ?? transcriptData.lang ?? null;

    this.logger.debug(
      `Transcribed (batch) [${languageCode}]: "${transcript.slice(0, 60)}"`,
    );

    return { transcript, languageCode };
  }

  // ── Batch Helpers ──────────────────────────────────────────────────

  private batchJobUrl(suffix = ''): string {
    return `${this.baseUrl}/speech-to-text/job/v1${suffix}`;
  }

  private async pollJobUntilDone(
    jobId: string,
  ): Promise<BatchStatusResponse> {
    for (let attempt = 1; attempt <= BATCH_MAX_POLLS; attempt++) {
      await new Promise((r) => setTimeout(r, BATCH_POLL_INTERVAL_MS));

      const res = await fetch(
        this.batchJobUrl(`/${jobId}/status`),
        {
          method: 'GET',
          headers: { 'api-subscription-key': this.apiKey },
        },
      );

      if (!res.ok) {
        this.logger.warn(
          `Batch STT poll ${attempt} failed (HTTP ${res.status}), retrying…`,
        );
        continue;
      }

      const data = (await res.json()) as BatchStatusResponse;

      if (attempt % 5 === 0 || data.job_state === 'Completed' || data.job_state === 'Failed') {
        this.logger.debug(
          `Batch STT poll ${attempt}: state=${data.job_state} (${data.successful_files_count}/${data.total_files} done)`,
        );
      }

      if (data.job_state === 'Completed' || data.job_state === 'Failed') {
        return data;
      }
    }

    throw new Error(
      `Sarvam batch STT timed out after ${BATCH_MAX_POLLS} polls (~${(BATCH_MAX_POLLS * BATCH_POLL_INTERVAL_MS) / 1000}s)`,
    );
  }

  /**
   * Estimate audio duration from buffer size. WhatsApp voice notes use
   * OGG/Opus at roughly 24-32 kbps → ~3-4 KB/s. We use 3 KB/s as a
   * conservative estimate so we route to batch slightly earlier rather
   * than risk the 30 s hard limit.
   */
  private estimateAudioDurationSeconds(
    buffer: Buffer,
    mimeType: string,
  ): number {
    const bytesPerSecond = this.getEstimatedBytesPerSecond(mimeType);
    return buffer.length / bytesPerSecond;
  }

  private getEstimatedBytesPerSecond(mimeType: string): number {
    const mt = mimeType.toLowerCase();
    // OGG/Opus (WhatsApp voice notes): variable bitrate ~16-24 kbps → ~2-3 KB/s
    // Using 2 KB/s to be conservative — better to route to batch too early
    // than to hit the 30 s hard limit on the sync endpoint.
    if (mt.includes('ogg') || mt.includes('opus')) return 2_000;
    // MP3: ~128 kbps → ~16 KB/s
    if (mt.includes('mp3') || mt.includes('mpeg')) return 16_000;
    // AAC/M4A: ~128 kbps → ~16 KB/s
    if (mt.includes('aac') || mt.includes('m4a') || mt.includes('mp4'))
      return 16_000;
    // WAV (16-bit, 16 kHz, mono): ~32 KB/s
    if (mt.includes('wav')) return 32_000;
    // Fallback: assume low bitrate like OGG
    return 2_000;
  }

  // ── Text to Speech ─────────────────────────────────────────────────

  /**
   * One valid OGG/Opus buffer per text chunk. Do NOT concatenate buffers — each
   * Sarvam response is a complete file; byte-concatenation breaks long replies.
   */
  async synthesizeChunks(
    text: string,
    languageCode: string | null,
  ): Promise<Buffer[]> {
    const targetLanguage = this.mapToSarvamLanguage(languageCode);
    const chunks = this.chunkText(text, 2500);
    const audioBuffers: Buffer[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
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
        throw new Error(
          `Sarvam TTS failed (chunk ${i + 1}/${chunks.length}): ${error}`,
        );
      }

      const data = (await response.json()) as { audios: string[] };
      if (!data.audios?.[0]) {
        throw new Error(
          `Sarvam TTS returned no audio (chunk ${i + 1}/${chunks.length})`,
        );
      }
      audioBuffers.push(Buffer.from(data.audios[0], 'base64'));
    }

    return audioBuffers;
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
