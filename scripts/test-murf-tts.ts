/// <reference types="node" />

import { MurfService } from '../src/whatsapp/murf-api/murf.service';

async function main(): Promise<void> {
  const text =
    process.argv.slice(2).join(' ').trim() ||
    'नमस्ते, मैं आपकी कैसे मदद कर सकता हूँ?';
  const locale = process.env.MURF_TEST_LOCALE || 'hi-IN';
  const startedAt = Date.now();

  const audioBuffers = await new MurfService().synthesizeChunks(text, locale);
  const totalBytes = audioBuffers.reduce(
    (total, audio) => total + audio.length,
    0,
  );

  if (audioBuffers.length !== 1 || totalBytes === 0) {
    throw new Error(
      'Murf smoke test did not return one non-empty audio buffer',
    );
  }

  if (audioBuffers[0].subarray(0, 4).toString('ascii') !== 'OggS') {
    throw new Error('Murf smoke test response is not an OGG container');
  }

  console.log(
    JSON.stringify({
      result: 'ok',
      locale,
      segments: audioBuffers.length,
      bytes: totalBytes,
      elapsedMs: Date.now() - startedAt,
    }),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Murf smoke test failed: ${message}`);
  process.exitCode = 1;
});
