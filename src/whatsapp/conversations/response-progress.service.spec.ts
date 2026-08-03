import { ResponseProgressService } from './response-progress.service';

describe('ResponseProgressService', () => {
  const sendTextMessage = jest.fn<Promise<void>, [string, string]>();
  const detectScript = jest.fn<string, [string]>();
  let service: ResponseProgressService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    sendTextMessage.mockResolvedValue(undefined);
    detectScript.mockReturnValue('Devanagari');
    service = new ResponseProgressService(
      { detect_script: detectScript } as any,
      { sendTextMessage } as any,
    );
    service.onModuleInit();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('uses English as the script fallback and keeps using only the 20-second pool afterwards', async () => {
    const session = await service.start({
      phoneNumber: '919999999999',
      messageId: 'wamid.1',
      sourceText: 'नमस्ते',
    });

    expect(detectScript).toHaveBeenCalledWith('नमस्ते');
    expect(sendTextMessage).toHaveBeenLastCalledWith(
      '919999999999',
      '🤖 Generating your response...',
    );

    await jest.advanceTimersByTimeAsync(5_000);
    expect(sendTextMessage).toHaveBeenLastCalledWith(
      '919999999999',
      '🔍 Understanding your question...',
    );

    await jest.advanceTimersByTimeAsync(15_000);
    expect(sendTextMessage).toHaveBeenLastCalledWith(
      '919999999999',
      '☕ Brewing ideas...',
    );

    await jest.advanceTimersByTimeAsync(5_000);
    expect(sendTextMessage).toHaveBeenLastCalledWith(
      '919999999999',
      '🔨 Tinkering with the details...',
    );

    await session.stop();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(sendTextMessage).toHaveBeenCalledTimes(6);
  });
});
