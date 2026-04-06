import { Injectable, Logger } from '@nestjs/common';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OpusEncoder } = require('@discordjs/opus');

/**
 * Handles bidirectional audio transcoding between WhatsApp (Opus/48kHz)
 * and Gemini Live (raw PCM/16kHz).
 *
 * Inbound  (WhatsApp → Gemini): Opus 48kHz → PCM 48kHz → Resample 16kHz → base64
 * Outbound (Gemini → WhatsApp): base64 → PCM 16kHz → Resample 48kHz → Opus 48kHz
 */

// Opus constants
const OPUS_SAMPLE_RATE = 48000;
const OPUS_CHANNELS = 1; // mono
const OPUS_FRAME_DURATION_MS = 20;
const OPUS_FRAME_SIZE = (OPUS_SAMPLE_RATE * OPUS_FRAME_DURATION_MS) / 1000; // 960 samples

// Gemini constants
const GEMINI_SAMPLE_RATE = 16000;

@Injectable()
export class AudioCodecService {
  private readonly logger = new Logger(AudioCodecService.name);

  // Opus encoder/decoder instance (thread-safe for encode/decode calls)
  private readonly opus: InstanceType<typeof OpusEncoder>;

  constructor() {
    this.opus = new OpusEncoder(OPUS_SAMPLE_RATE, OPUS_CHANNELS);
    this.logger.log(
      `AudioCodec initialized: Opus ${OPUS_SAMPLE_RATE}Hz ↔ PCM ${GEMINI_SAMPLE_RATE}Hz`,
    );
  }

  /**
   * Generate an Opus-encoded silence frame (20ms of silence at 48kHz mono).
   * Used to keep the WebRTC connection alive while waiting for Gemini to respond.
   */
  getSilenceOpusFrame(): Buffer {
    // 960 samples of silence (20ms at 48kHz), 16-bit = 1920 bytes of zeros
    const silencePcm = Buffer.alloc(OPUS_FRAME_SIZE * 2, 0);
    return this.opus.encode(silencePcm);
  }

  /**
   * INBOUND: Decode Opus RTP payload → downsample → return base64 PCM for Gemini.
   *
   * @param opusPayload - Raw Opus frame bytes from WebRTC RTP packet
   * @returns base64-encoded PCM (16kHz, mono, signed 16-bit LE) for Gemini
   */
  decodeOpusToPcm16k(opusPayload: Buffer): string {
    try {
      // 1. Decode Opus → PCM 48kHz (signed 16-bit LE)
      const pcm48k: Buffer = this.opus.decode(opusPayload);

      // 2. Downsample 48kHz → 16kHz (ratio 3:1)
      const pcm16k = this.resample(pcm48k, OPUS_SAMPLE_RATE, GEMINI_SAMPLE_RATE);

      // 3. Return as base64
      return pcm16k.toString('base64');
    } catch (err: any) {
      this.logger.error(`Opus decode failed: ${err.message}`);
      return '';
    }
  }

  /**
   * OUTBOUND: Encode PCM from Gemini → upsample → Opus frames for WebRTC.
   *
   * @param pcmBase64 - base64-encoded PCM (mono, signed 16-bit LE) from Gemini
   * @param sourceSampleRate - Sample rate of the input PCM (e.g. 24000 for Gemini default)
   * @returns Array of Opus-encoded frame buffers ready for RTP
   */
  encodePcmToOpus(pcmBase64: string, sourceSampleRate: number = 24000): Buffer[] {
    try {
      const pcmInput = Buffer.from(pcmBase64, 'base64');

      // 1. Upsample from source rate → 48kHz (Opus native rate)
      let pcm48k: Buffer;
      if (sourceSampleRate === OPUS_SAMPLE_RATE) {
        pcm48k = pcmInput; // Already at 48kHz, no resampling needed
      } else {
        pcm48k = this.resample(pcmInput, sourceSampleRate, OPUS_SAMPLE_RATE);
      }

      // 2. Split into Opus frame-sized chunks (960 samples = 1920 bytes at 16-bit)
      const frameSizeBytes = OPUS_FRAME_SIZE * 2; // 2 bytes per sample (16-bit)
      const opusFrames: Buffer[] = [];

      for (let offset = 0; offset + frameSizeBytes <= pcm48k.length; offset += frameSizeBytes) {
        const frame = pcm48k.subarray(offset, offset + frameSizeBytes);
        const encoded: Buffer = this.opus.encode(frame);
        opusFrames.push(encoded);
      }

      return opusFrames;
    } catch (err: any) {
      this.logger.error(`Opus encode failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Resample PCM buffer from one sample rate to another.
   * Works for both upsampling and downsampling using linear interpolation.
   * Sufficient quality for voice audio.
   *
   * @param input - PCM buffer (signed 16-bit LE)
   * @param fromRate - Source sample rate (e.g. 48000)
   * @param toRate - Target sample rate (e.g. 16000)
   */
  resample(input: Buffer, fromRate: number, toRate: number): Buffer {
    if (fromRate === toRate) return input;

    const inputSamples = input.length / 2; // 16-bit = 2 bytes per sample
    const outputSamples = Math.round((inputSamples * toRate) / fromRate);
    const output = Buffer.alloc(outputSamples * 2);
    const ratio = fromRate / toRate;

    for (let i = 0; i < outputSamples; i++) {
      const srcIdx = i * ratio;
      const srcIdxFloor = Math.floor(srcIdx);
      const srcIdxCeil = Math.min(srcIdxFloor + 1, inputSamples - 1);
      const frac = srcIdx - srcIdxFloor;

      const sampleA = input.readInt16LE(srcIdxFloor * 2);
      const sampleB = input.readInt16LE(srcIdxCeil * 2);

      // Linear interpolation
      const interpolated = Math.round(sampleA + (sampleB - sampleA) * frac);
      output.writeInt16LE(
        Math.max(-32768, Math.min(32767, interpolated)),
        i * 2,
      );
    }

    return output;
  }
}

