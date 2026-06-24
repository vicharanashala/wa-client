import { LanguageSupportService } from './language-support.service';

describe('LanguageSupportService', () => {
  let service: LanguageSupportService;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    delete process.env.LLM_API_KEY;
    service = new LanguageSupportService();
    service.onModuleInit();
  });

  it('resolves English text as English/English', async () => {
    await expect(
      service.resolveLanguagePair('What is the best fertilizer for wheat?'),
    ).resolves.toMatchObject({
      scriptLanguage: 'English',
      vocalLanguage: 'English',
      detectedScript: 'Latin',
    });
  });

  it('resolves Hinglish text as English script and Hindi vocal language', async () => {
    process.env.LLM_API_KEY = 'test-key';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Hindi' }],
      }),
    } as Response);
    service = new LanguageSupportService();
    service.onModuleInit();

    await expect(
      service.resolveLanguagePair('Mera gehu ke baare me sawal hai'),
    ).resolves.toMatchObject({
      scriptLanguage: 'English',
      vocalLanguage: 'Hindi',
      detectedScript: 'Latin',
    });

    const requestBody = JSON.parse(
      String(fetchMock.mock.calls[0][1]?.body ?? '{}'),
    ) as { messages: { content: string }[] };
    expect(requestBody.messages[0].content).toContain('CRITICAL RULE');
    expect(requestBody.messages[0].content).toContain('CROP NAME RULE');
    expect(requestBody.messages[0].content).toContain('LOCATION-ONLY RULE');
    expect(requestBody.messages[0].content).toContain(
      'NEVER classify as Hindi just because the text mentions Indian place names',
    );
  });

  it('uses STT language code for romanized non-Hindi text', async () => {
    await expect(
      service.resolveLanguagePair('Barli pantalo aphids ela control cheyali', {
        sttLanguageCode: 'te-IN',
      }),
    ).resolves.toMatchObject({
      scriptLanguage: 'English',
      vocalLanguage: 'Telugu',
      detectedScript: 'Latin',
    });
  });

  it('resolves native Telugu script as Telugu/Telugu', async () => {
    await expect(
      service.resolveLanguagePair('వరిలో పురుగు ఎలా నియంత్రించాలి?'),
    ).resolves.toMatchObject({
      scriptLanguage: 'Telugu',
      vocalLanguage: 'Telugu',
      detectedScript: 'Telugu',
    });
  });

  it('loads pair-keyed catalog rows for romanized Hindi', () => {
    const row = service.getCatalogRow({
      scriptLanguage: 'English',
      vocalLanguage: 'Hindi',
    });

    expect(row.scriptLanguage).toBe('English');
    expect(row.vocalLanguage).toBe('Hindi');
    expect(row.testingDisclaimer.length).toBeGreaterThan(0);
  });
});
