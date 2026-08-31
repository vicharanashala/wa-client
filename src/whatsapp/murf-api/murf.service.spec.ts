jest.mock('@discordjs/opus', () => ({
  OpusEncoder: class {
    encode(): Buffer {
      return Buffer.from([0xf8, 0xff, 0xfe]);
    }
  },
}));

import { MurfService } from './murf.service';

describe('MurfService', () => {
  const originalEnv = {
    apiKey: process.env.MURF_API_KEY,
    voiceId: process.env.MURF_TTS_VOICE_ID,
    endpoint: process.env.MURF_TTS_ENDPOINT,
  };

  beforeEach(() => {
    process.env.MURF_API_KEY = 'test-key';
    delete process.env.MURF_TTS_VOICE_ID;
    process.env.MURF_TTS_ENDPOINT = 'https://example.test/v1/speech/stream';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    restoreEnv('MURF_API_KEY', originalEnv.apiKey);
    restoreEnv('MURF_TTS_VOICE_ID', originalEnv.voiceId);
    restoreEnv('MURF_TTS_ENDPOINT', originalEnv.endpoint);
  });

  it('requests Falcon PCM and packages it as Ogg/Opus', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(new Uint8Array(1920), { status: 200 }));

    const audio = await new MurfService().synthesizeChunks('नमस्ते', 'hi-IN');

    expect(audio).toHaveLength(1);
    expect(audio[0].subarray(0, 4).toString('ascii')).toBe('OggS');
    expect(audio[0].includes(Buffer.from('OpusHead'))).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/v1/speech/stream',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'api-key': 'test-key',
          'Content-Type': 'application/json',
        },
      }),
    );

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual({
      text: 'नमस्ते',
      voiceId: 'hi-IN-namrita',
      model: 'falcon-2',
      locale: 'hi-IN',
      channelType: 'MONO',
      format: 'PCM',
      sampleRate: 48000,
    });
  });

  it('uses the Gujarati Falcon voice when no explicit voice is configured', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(new Uint8Array(1920), { status: 200 }));

    await new MurfService().synthesizeChunks('નમસ્તે', 'gu-IN');

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({
      voiceId: 'gu-IN-diya',
      locale: 'gu-IN',
    });
  });

  it("maps Sarvam's Odia code to Murf's Falcon locale", async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(new Uint8Array(1920), { status: 200 }));

    await new MurfService().synthesizeChunks('ନମସ୍କାର', 'od-IN');

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({
      locale: 'or-IN',
      voiceId: 'en-IN-samar',
    });
  });

  it('fails before making a request when the API key is missing', async () => {
    delete process.env.MURF_API_KEY;
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(
      new MurfService().synthesizeChunks('hello', 'en-IN'),
    ).rejects.toThrow('MURF_API_KEY is not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
