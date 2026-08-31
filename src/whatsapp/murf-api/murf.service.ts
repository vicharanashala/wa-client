import { Injectable, Logger } from '@nestjs/common';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OpusEncoder } = require('@discordjs/opus');

const DEFAULT_ENDPOINT = 'https://in.api.murf.ai/v1/speech/stream';
const VOICE_NOTE_TEXT_CHUNK_SIZE = 2500;
const FALCON_TEXT_CHUNK_SIZE = 250;
const PCM_SAMPLE_RATE = 48000;
const OPUS_FRAME_SIZE = 960; // 20 ms at 48 kHz
const OPUS_FRAME_BYTES = OPUS_FRAME_SIZE * 2; // 16-bit mono PCM

const DEFAULT_VOICE_BY_LOCALE: Record<string, string> = {
  'hi-IN': 'hi-IN-namrita',
  'te-IN': 'en-IN-samar',
  'ta-IN': 'ta-IN-karthikeyan',
  'mr-IN': 'mr-IN-vaibhav',
  'bn-IN': 'bn-IN-debarati',
  'gu-IN': 'gu-IN-diya',
  'kn-IN': 'kn-IN-harshitha',
  'ml-IN': 'ml-IN-nimisha',
  'pa-IN': 'pa-IN-harman',
  'or-IN': 'en-IN-samar',
  'en-IN': 'en-IN-samar',
};

/**
 * Murf Falcon 2 text-to-speech client.
 *
 * Murf's OGG output is currently returning HTTP 500 for this account, so we
 * request its supported raw PCM output and package it as Ogg/Opus locally.
 * WhatsApp requires the resulting complete Ogg/Opus file for each voice note.
 */
@Injectable()
export class MurfService {
  private readonly logger = new Logger(MurfService.name);
  private readonly apiKey = process.env.MURF_API_KEY || '';
  private readonly endpoint = process.env.MURF_TTS_ENDPOINT || DEFAULT_ENDPOINT;
  private readonly configuredVoiceId = process.env.MURF_TTS_VOICE_ID;

  async synthesizeChunks(
    text: string,
    languageCode: string | null,
  ): Promise<Buffer[]> {
    if (!this.apiKey) {
      throw new Error('MURF_API_KEY is not configured');
    }

    const locale = this.mapToMurfLocale(languageCode);
    const voiceId = this.voiceForLocale(locale);
    const voiceNoteChunks = this.chunkText(text, VOICE_NOTE_TEXT_CHUNK_SIZE);
    const audioBuffers: Buffer[] = [];

    for (const voiceNoteChunk of voiceNoteChunks) {
      const falconChunks = this.chunkText(
        voiceNoteChunk,
        FALCON_TEXT_CHUNK_SIZE,
      );
      const pcmChunks: Buffer[] = [];

      for (const falconChunk of falconChunks) {
        pcmChunks.push(await this.synthesizePcm(falconChunk, voiceId, locale));
      }

      audioBuffers.push(this.encodeOggOpus(Buffer.concat(pcmChunks)));
    }

    this.logger.debug(
      `Murf Falcon synthesized ${audioBuffers.length} Ogg/Opus segment(s) using ${voiceId} (${locale})`,
    );
    return audioBuffers;
  }

  private voiceForLocale(locale: string): string {
    if (this.configuredVoiceId) return this.configuredVoiceId;
    if (locale === 'gu-IN' && process.env.MURF_TTS_GUJARATI_VOICE_ID) {
      return process.env.MURF_TTS_GUJARATI_VOICE_ID;
    }
    return DEFAULT_VOICE_BY_LOCALE[locale] ?? DEFAULT_VOICE_BY_LOCALE['hi-IN'];
  }

  private async synthesizePcm(
    text: string,
    voiceId: string,
    locale: string,
  ): Promise<Buffer> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        voiceId,
        model: 'falcon-2',
        locale,
        channelType: 'MONO',
        format: 'PCM',
        sampleRate: PCM_SAMPLE_RATE,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Murf Falcon TTS failed (HTTP ${response.status}): ${error}`,
      );
    }

    const pcm = this.extractPcm(Buffer.from(await response.arrayBuffer()));
    if (pcm.length === 0 || pcm.length % 2 !== 0) {
      throw new Error('Murf Falcon TTS returned invalid PCM audio');
    }

    return pcm;
  }

  /** Murf currently labels raw PCM as audio/wav on some responses. */
  private extractPcm(audio: Buffer): Buffer {
    if (audio.subarray(0, 4).toString('ascii') !== 'RIFF') return audio;
    if (audio.subarray(8, 12).toString('ascii') !== 'WAVE') {
      throw new Error('Murf Falcon TTS returned an invalid WAV container');
    }

    let offset = 12;
    while (offset + 8 <= audio.length) {
      const chunkId = audio.subarray(offset, offset + 4).toString('ascii');
      const chunkSize = audio.readUInt32LE(offset + 4);
      const dataStart = offset + 8;
      const dataEnd = dataStart + chunkSize;
      if (dataEnd > audio.length) {
        throw new Error('Murf Falcon TTS returned a truncated WAV container');
      }
      if (chunkId === 'data') return audio.subarray(dataStart, dataEnd);
      offset = dataEnd + (chunkSize % 2);
    }

    throw new Error('Murf Falcon TTS WAV response has no PCM data chunk');
  }

  private encodeOggOpus(pcm: Buffer): Buffer {
    const encoder = new OpusEncoder(PCM_SAMPLE_RATE, 1);
    const serial = Date.now() >>> 0;
    const pages = [
      this.createOggPage(this.opusHead(), 0x02, 0n, serial, 0),
      this.createOggPage(this.opusTags(), 0, 0n, serial, 1),
    ];

    let sequence = 2;
    let granulePosition = 0;
    for (let offset = 0; offset < pcm.length; offset += OPUS_FRAME_BYTES) {
      const frame = Buffer.alloc(OPUS_FRAME_BYTES);
      pcm.copy(frame, 0, offset, offset + OPUS_FRAME_BYTES);
      const packet = encoder.encode(frame);
      granulePosition += OPUS_FRAME_SIZE;
      const isLastFrame = offset + OPUS_FRAME_BYTES >= pcm.length;
      pages.push(
        this.createOggPage(
          packet,
          isLastFrame ? 0x04 : 0,
          BigInt(granulePosition),
          serial,
          sequence++,
        ),
      );
    }

    return Buffer.concat(pages);
  }

  private opusHead(): Buffer {
    const head = Buffer.alloc(19);
    head.write('OpusHead');
    head.writeUInt8(1, 8); // version
    head.writeUInt8(1, 9); // mono
    head.writeUInt16LE(312, 10); // pre-skip required by Opus decoders
    head.writeUInt32LE(PCM_SAMPLE_RATE, 12);
    head.writeInt16LE(0, 16); // output gain
    head.writeUInt8(0, 18); // channel mapping family
    return head;
  }

  private opusTags(): Buffer {
    const vendor = Buffer.from('wa-client');
    const tags = Buffer.alloc(16 + vendor.length);
    tags.write('OpusTags');
    tags.writeUInt32LE(vendor.length, 8);
    vendor.copy(tags, 12);
    tags.writeUInt32LE(0, 12 + vendor.length); // user comment count
    return tags;
  }

  private createOggPage(
    packet: Buffer,
    headerType: number,
    granulePosition: bigint,
    serial: number,
    sequence: number,
  ): Buffer {
    const lacingValues: number[] = [];
    let remaining = packet.length;
    while (remaining >= 255) {
      lacingValues.push(255);
      remaining -= 255;
    }
    lacingValues.push(remaining);

    const page = Buffer.alloc(27 + lacingValues.length + packet.length);
    page.write('OggS');
    page.writeUInt8(0, 4); // stream structure version
    page.writeUInt8(headerType, 5);
    page.writeBigUInt64LE(granulePosition, 6);
    page.writeUInt32LE(serial, 14);
    page.writeUInt32LE(sequence, 18);
    page.writeUInt32LE(0, 22); // checksum is calculated with this field set to zero
    page.writeUInt8(lacingValues.length, 26);
    Buffer.from(lacingValues).copy(page, 27);
    packet.copy(page, 27 + lacingValues.length);
    page.writeUInt32LE(this.oggChecksum(page), 22);
    return page;
  }

  private oggChecksum(buffer: Buffer): number {
    let crc = 0;
    for (const byte of buffer) {
      crc ^= byte << 24;
      for (let bit = 0; bit < 8; bit++) {
        crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
      }
    }
    return crc >>> 0;
  }

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

  private mapToMurfLocale(bcp47Code: string | null): string {
    const localeMap: Record<string, string> = {
      'hi-IN': 'hi-IN',
      'te-IN': 'te-IN',
      'ta-IN': 'ta-IN',
      'mr-IN': 'mr-IN',
      'bn-IN': 'bn-IN',
      'gu-IN': 'gu-IN',
      'kn-IN': 'kn-IN',
      'ml-IN': 'ml-IN',
      'pa-IN': 'pa-IN',
      // Sarvam returns `od-IN`; Murf uses the current BCP-47 `or-IN` code.
      'od-IN': 'or-IN',
      'or-IN': 'or-IN',
      'en-IN': 'en-IN',
    };

    return bcp47Code ? (localeMap[bcp47Code] ?? 'hi-IN') : 'hi-IN';
  }
}
