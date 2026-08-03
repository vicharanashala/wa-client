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
      '⏳ Your request is being processed. This usually takes around 10–20 seconds.',
    );

    await jest.advanceTimersByTimeAsync(5_000);
    expect(sendTextMessage).toHaveBeenLastCalledWith(
      '919999999999',
      '🧠 Still working on your request. Thanks for your patience.',
    );

    await jest.advanceTimersByTimeAsync(15_000);
    expect(sendTextMessage).toHaveBeenLastCalledWith(
      '919999999999',
      '⏳ This is taking longer than usual, but your request is still being processed.',
    );

    await jest.advanceTimersByTimeAsync(5_000);
    expect(sendTextMessage).toHaveBeenLastCalledWith(
      '919999999999',
      '🚀 Thanks for waiting. I'm still working on your response.',
    );

    await session.stop();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(sendTextMessage).toHaveBeenCalledTimes(6);
  });
});