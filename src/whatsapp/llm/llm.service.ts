import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ChatAnthropic } from '@langchain/anthropic';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { createAgent } from 'langchain';
import { AIMessage, BaseMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { SYSTEM_PROMPT } from './system-prompt';


export interface LlmResult {
  reply: string;
  toolCalls: { toolCallId: string; toolName: string; input: string }[];
  toolResults: { toolCallId: string; toolName: string; result: string }[];
}

type ResponseLanguage = 'english' | 'devanagari' | 'unknown';


@Injectable()
export class LlmService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LlmService.name);
  private static readonly REQUIRED_SOIL_TOOLS = [
    'soilhealth__get_states',
    'soilhealth__get_districts',
    'soilhealth__get_crops',
    'soilhealth__get_fertilizer_dosage',
  ];
  private static readonly GOVT_SCHEMES_TOOLS = [
    'govt-schemes__govt_schemes',
    'govt-schemes__get_scheme_details',
  ];

  private mcpClient: MultiServerMCPClient;
  private agent: ReturnType<typeof createAgent>;
  private tools: Awaited<ReturnType<MultiServerMCPClient['getTools']>> = [];

  async onModuleInit(): Promise<void> {
    this.mcpClient = new MultiServerMCPClient({
      mcpServers: {
        golden: {
          transport: 'http',
          url: 'http://100.100.108.44:9005/mcp',
        },
        pop: {
          transport: 'http',
          url: 'http://100.100.108.44:9012/mcp',
        },
        agmarknet: {
          transport: 'http',
          url: process.env.MCP_AGMARKNET_URL || 'http://100.100.108.44:9006/mcp',
        },
        enam: {
          transport: 'http',
          url: process.env.MCP_ENAM_URL || 'http://100.100.108.44:9002/mcp',
        },
        weather: {
          transport: 'http',
          url: 'http://100.100.108.44:9003/mcp',
        },
        'faq-videos': {
          transport: 'http',
          url: 'http://100.100.108.44:9010/mcp',
        },
        soilhealth: {
          transport: 'http',
          url: process.env.MCP_SOILHEALTH_URL || 'http://100.100.108.44:9008/mcp',
        },
        reviewer_new: {
          transport: 'http',
          url: 'http://100.100.108.44:9007/mcp',
        },
        'govt-schemes': {
          transport: 'http',
          url: process.env.MCP_GOVT_SCHEMES_URL || 'http://100.100.108.44:9009/mcp',
        },
        'chemical-checker': {
          transport: 'http',
          url: process.env.MCP_CHEMICAL_CHECKER_URL || 'http://100.100.108.44:9101/mcp',
        },
      },
      onConnectionError: 'ignore',
      prefixToolNameWithServerName: true,
    });

    const rawTools = await this.mcpClient.getTools();
    this.tools = Array.from(new Map(rawTools.map((t) => [t.name, t])).values());

    this.logger.log(
      `Loaded ${this.tools.length} unique tools: ${this.tools.map((t) => t.name).join(', ')}`,
    );
    this.logSoilToolAvailability();

    this.agent = createAgent({
      model: new ChatAnthropic({
        modelName: process.env.LLM_MODEL === 'default' ? 'claude-sonnet-4-5-20250929' : (process.env.LLM_MODEL || 'claude-sonnet-4-5-20250929'),
        apiKey: process.env.LLM_API_KEY || 'dummy-key',
        maxTokens: 8192,
      }),
      tools: this.tools.filter(t => t.name !== 'reviewer_new__upload_question_to_reviewer_system'),
      systemPrompt: SYSTEM_PROMPT
    });

    this.logger.log('LLM agent initialized');
  }

  async onModuleDestroy(): Promise<void> {
    await this.mcpClient.close();
    this.logger.log('MCP client closed');
  }

  async callTool(
    toolName: string,
    input: Record<string, any>,
  ): Promise<string> {
    const tool = this.tools.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(`Tool "${toolName}" not found among ${this.tools.length} loaded tools`);
    }
    const result = await tool.invoke(input);
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  async generate(messages: BaseMessage[]): Promise<LlmResult> {
    const preferredLanguage = this.detectPreferredLanguage(messages);
    const languageConstrainedMessages = this.withLanguageInstruction(
      messages,
      preferredLanguage,
    );

    const initialResult = await this.invokeAgentWithRetry(languageConstrainedMessages);
    if (!initialResult) {
      return this.getFallbackResult();
    }

    let parsed = this.parseAgentResult(initialResult);

    if (
      this.shouldForceSoilToolCall(messages) &&
      !this.hasSoilToolInteraction(parsed)
    ) {
      this.logger.warn(
        'Soil dosage intent detected with complete inputs but no soil tool call.',
      );
      const forcedMessages = [
        ...languageConstrainedMessages,
        new HumanMessage(
          'PRIORITY INSTRUCTION: The user has already provided N, P, K, Organic Carbon, State, District, and Crop. You MUST call the soilhealth fertilizer dosage tool now using smart state/district matching. Do not refuse or ask for the same inputs again.',
        ),
      ];

      const forcedResult = await this.invokeAgentWithRetry(forcedMessages);
      if (forcedResult) {
        parsed = this.parseAgentResult(forcedResult);
      }
    }

    if (this.isLanguageMismatch(preferredLanguage, parsed.reply)) {
      const strictLanguageMessages = this.withLanguageInstruction(
        messages,
        preferredLanguage,
        true,
      );
      const strictLanguageResult = await this.invokeAgentWithRetry(strictLanguageMessages);
      if (strictLanguageResult) {
        parsed = this.parseAgentResult(strictLanguageResult);
      }
    }

    if (
      this.shouldForceGovtSchemesToolChain(messages) &&
      !this.hasGovtSchemesToolInteraction(parsed)
    ) {
      this.logger.warn(
        'Government scheme intent detected but no govt_schemes tool interaction was made.',
      );
      const forcedGovtSchemesMessages = [
        ...languageConstrainedMessages,
        new HumanMessage(
          'PRIORITY INSTRUCTION: This user is asking about government schemes. You MUST call govt-schemes__govt_schemes first (use state="All" when state is unknown), then use govt-schemes__get_scheme_details for specific scheme detail requests. Never expose slug values in the user-facing response. Ask only 3-4 essential profile fields first when user profile is missing.',
        ),
      ];
      const forcedGovtSchemesResult = await this.invokeAgentWithRetry(
        forcedGovtSchemesMessages,
      );
      if (forcedGovtSchemesResult) {
        parsed = this.parseAgentResult(forcedGovtSchemesResult);
      }
    }

    parsed.reply = this.normalizeWhatsappFormatting(parsed.reply);
    parsed.reply = this.removeGovernmentSchemeSlugLeak(parsed.reply);
    parsed.reply = this.promoteSoilCitationToTop(parsed.reply);
    parsed.reply = this.appendGovtSchemesCitation(parsed, preferredLanguage);
    return parsed;
  }



  private appendGovtSchemesCitation(
    parsed: LlmResult,
    preferredLanguage: ResponseLanguage,
  ): string {
    const calledGovtSchemesTool =
      parsed.toolCalls.some((tc) => LlmService.GOVT_SCHEMES_TOOLS.includes(tc.toolName)) ||
      parsed.toolResults.some((tr) => LlmService.GOVT_SCHEMES_TOOLS.includes(tr.toolName));

    if (!calledGovtSchemesTool) {
      return parsed.reply;
    }

    const sourceUrl =
      'https://www.myscheme.gov.in/search/category/Agriculture,Rural%20%26%20Environment';
    if (parsed.reply.includes(sourceUrl)) {
      return parsed.reply;
    }

    const citation = this.getGovtSchemesCitationLine(parsed.reply, preferredLanguage);
    return this.insertBeforeDisclaimer(parsed.reply, citation);
  }

  private getGovtSchemesCitationLine(
    reply: string,
    preferredLanguage: ResponseLanguage,
  ): string {
    const sourceUrl =
      'https://www.myscheme.gov.in/search/category/Agriculture,Rural%20%26%20Environment';

    if (reply.match(/[\u0A00-\u0A7F]/)) {
      return `📚 ਸਰੋਤ: ਇਹ ਜਾਣਕਾਰੀ MyScheme ਸਰਕਾਰੀ ਪੋਰਟਲ ਤੋਂ ਲਈ ਗਈ ਹੈ: ${sourceUrl}`;
    }
    if (reply.match(/[\u0A80-\u0AFF]/)) {
      return `📚 સ્રોત: આ માહિતી MyScheme સરકારી પોર્ટલ પરથી લેવામાં આવી છે: ${sourceUrl}`;
    }
    if (reply.match(/[\u0980-\u09FF]/)) {
      return `📚 উৎস: এই তথ্য MyScheme সরকারি পোর্টাল থেকে নেওয়া হয়েছে: ${sourceUrl}`;
    }
    if (reply.match(/[\u0B80-\u0BFF]/)) {
      return `📚 மூலம்: இந்த தகவல் MyScheme அரசு போர்டலில் இருந்து பெறப்பட்டுள்ளது: ${sourceUrl}`;
    }
    if (reply.match(/[\u0C00-\u0C7F]/)) {
      return `📚 మూలం: ఈ సమాచారం MyScheme ప్రభుత్వ పోర్టల్ నుండి తీసుకోబడింది: ${sourceUrl}`;
    }
    if (reply.match(/[\u0C80-\u0CFF]/)) {
      return `📚 ಮೂಲ: ಈ ಮಾಹಿತಿ MyScheme ಸರ್ಕಾರಿ ಪೋರ್ಟಲ್‌ನಿಂದ ಪಡೆಯಲಾಗಿದೆ: ${sourceUrl}`;
    }
    if (reply.match(/[\u0D00-\u0D7F]/)) {
      return `📚 ഉറവിടം: ഈ വിവരം MyScheme സർക്കാർ പോർട്ടലിൽ നിന്ന് എടുത്തതാണ്: ${sourceUrl}`;
    }
    if (reply.match(/[\u0B00-\u0B7F]/)) {
      return `📚 ଉତ୍ସ: ଏହି ସୂଚନା MyScheme ସରକାରୀ ପୋର୍ଟାଲରୁ ନିଆଯାଇଛି: ${sourceUrl}`;
    }
    if (reply.match(/[\u0900-\u097F]/) || preferredLanguage === 'devanagari') {
      return `📚 स्रोत: यह जानकारी MyScheme सरकारी पोर्टल से ली गई है: ${sourceUrl}`;
    }

    return `📚 Source: This information is sourced from the MyScheme government portal: ${sourceUrl}`;
  }

  private insertBeforeDisclaimer(reply: string, lineToInsert: string): string {
    if (!lineToInsert) return reply;
    const disclaimer =
      '⚠️ This is a testing version. Please consult an expert before making farming decisions.';

    if (reply.includes(disclaimer)) {
      return reply.replace(disclaimer, `${lineToInsert}\n\n${disclaimer}`);
    }
    return `${reply}\n\n${lineToInsert}`.trim();
  }

  private async invokeAgentWithRetry(messages: BaseMessage[]): Promise<any | null> {
    let result: any;
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        result = await this.agent.invoke({ messages });
        return result;
      } catch (err: any) {
        const errorMsg = err?.message || String(err);
        this.logger.error(
          `LLM agent error (attempt ${attempt}/${maxRetries}): ${errorMsg}`,
        );

        const isNonRecoverable =
          errorMsg.includes('prompt is too long') ||
          errorMsg.includes('context_length_exceeded') ||
          errorMsg.includes('invalid_api_key');

        if (isNonRecoverable) {
          this.logger.error('Non-recoverable error, skipping retries.');
          return null;
        }

        if (attempt < maxRetries) {
          const delayMs = attempt * 1000;
          this.logger.warn(`Retrying in ${delayMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        this.logger.error(`LLM agent failed after ${maxRetries} attempt(s)`);
        return null;
      }
    }
    return null;
  }

  private parseAgentResult(result: any): LlmResult {
    const toolCalls: LlmResult['toolCalls'] = [];
    const toolResults: LlmResult['toolResults'] = [];
    let reply = '';

    for (const msg of result.messages) {
      if (msg._getType() === 'ai') {
        const aiMsg = msg as AIMessage;
        if (aiMsg.tool_calls?.length || aiMsg.additional_kwargs?.tool_calls?.length) {
          const calls = aiMsg.tool_calls?.length ? aiMsg.tool_calls : aiMsg.additional_kwargs?.tool_calls;
          for (const tc of (calls as any[]) ?? []) {
            const toolName = tc.name || (tc.function && tc.function.name);
            const input = tc.args ? JSON.stringify(tc.args) : (tc.function && tc.function.arguments);
            toolCalls.push({
              toolCallId: tc.id,
              toolName: toolName,
              input: typeof input === 'string' ? input : JSON.stringify(input || {}),
            });
          }
        }
      }

      if (msg._getType() === 'tool') {
        const toolMsg = msg as ToolMessage;
        toolResults.push({
          toolCallId: toolMsg.tool_call_id,
          toolName: toolMsg.name ?? '',
          result: typeof toolMsg.content === 'string'
            ? toolMsg.content
            : JSON.stringify(toolMsg.content),
        });
      }
    }

    const lastMsg = result.messages.findLast((m) => m._getType() === 'ai');
    const content = lastMsg?.content;
    if (typeof content === 'string') reply = content;
    else if (Array.isArray(content)) {
      reply = content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    }

    return { reply, toolCalls, toolResults };
  }

  private getFallbackResult(): LlmResult {
    return {
      reply: 'I could not process your request right now. Please try again.',
      toolCalls: [],
      toolResults: [],
    };
  }

  private shouldForceSoilToolCall(messages: BaseMessage[]): boolean {
    const latestHuman = [...messages]
      .reverse()
      .find((msg) => msg._getType() === 'human');

    const content = latestHuman?.content;
    const text = typeof content === 'string'
      ? content.toLowerCase()
      : Array.isArray(content)
        ? content
          .filter((block: any) => block?.type === 'text')
          .map((block: any) => String(block.text ?? ''))
          .join(' ')
          .toLowerCase()
        : '';

    if (!text) return false;

    const hasN = /nitrogen|(^|\s)n(\s|:|=|\d)/i.test(text);
    const hasP = /phosphorus|(^|\s)p(\s|:|=|\d)/i.test(text);
    const hasK = /potassium|(^|\s)k(\s|:|=|\d)/i.test(text);
    const hasOc = /organic\s*carbon|(^|\s)oc(\s|:|=|\d|%)/i.test(text);
    const hasCrop = /crop\s*[:=]?\s*[a-z]/i.test(text);
    const hasState = /state\s*[:=]?\s*[a-z]/i.test(text);
    const hasDistrict = /(district|distict)\s*[:=]?\s*[a-z]/i.test(text);

    return hasN && hasP && hasK && hasOc && hasCrop && hasState && hasDistrict;
  }

  private hasSoilToolInteraction(result: LlmResult): boolean {
    const allToolNames = [
      ...result.toolCalls.map((t) => t.toolName || ''),
      ...result.toolResults.map((t) => t.toolName || ''),
    ];
    return allToolNames.some((name) =>
      /(soil|fertilizer|dosage|get_states|get_districts|get_crops)/i.test(name),
    );
  }

  private shouldForceGovtSchemesToolChain(messages: BaseMessage[]): boolean {
    const latestHuman = [...messages]
      .reverse()
      .find((msg) => msg._getType() === 'human');
    const text = this.messageContentToText(latestHuman?.content).toLowerCase();
    if (!text) return false;

    return (
      /(government scheme|govt scheme|scheme for me|yojana|subsidy|welfare scheme|eligible scheme)/i.test(
        text,
      ) || /tell me about .*scheme/i.test(text)
    );
  }

  private hasGovtSchemesToolInteraction(result: LlmResult): boolean {
    const allToolNames = [
      ...result.toolCalls.map((t) => t.toolName || ''),
      ...result.toolResults.map((t) => t.toolName || ''),
    ];

    return allToolNames.some((name) =>
      LlmService.GOVT_SCHEMES_TOOLS.includes(name),
    );
  }

  private logSoilToolAvailability(): void {
    const availableToolNames = new Set(this.tools.map((t) => t.name));
    const missingTools = LlmService.REQUIRED_SOIL_TOOLS.filter(
      (toolName) => !availableToolNames.has(toolName),
    );

    if (missingTools.length > 0) {
      this.logger.error(
        `Soilhealth MCP tools missing: ${missingTools.join(', ')}. ` +
        'Fertilizer dosage flow will fail until MCP_SOILHEALTH_URL is reachable.',
      );
      return;
    }

    this.logger.log('Soilhealth MCP tools available for fertilizer dosage flow.');
  }

  private normalizeWhatsappFormatting(text: string): string {
    if (!text) return text;

    let normalized = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');
    normalized = normalized.replace(/\*\*(.*?)\*\*/g, '*$1*');
    normalized = normalized.replace(/__(.*?)__/g, '*$1*');
    normalized = normalized.replace(/```[\s\S]*?```/g, '');
    normalized = normalized.replace(/`([^`]+)`/g, '$1');
    normalized = normalized.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
    normalized = normalized.replace(/^[\s]*[•●▪◦]\s*/gm, '');
    normalized = normalized.replace(/[ \t]+\n/g, '\n');
    normalized = normalized.replace(/\n{3,}/g, '\n\n');

    return normalized.trim();
  }

  private removeGovernmentSchemeSlugLeak(text: string): string {
    if (!text) return text;

    let sanitized = text.replace(
      /\s*\((?:scheme\s*)?slug\s*:\s*[^)]+\)/gi,
      '',
    );
    sanitized = sanitized.replace(/\bslug\s*:\s*[\w-]+/gi, '');
    sanitized = sanitized.replace(/\n{3,}/g, '\n\n');
    return sanitized.trim();
  }

  private promoteSoilCitationToTop(text: string): string {
    if (!text) return text;
    const citationRegex =
      /📋\s*This information is sourced from the official Soil Health Card portal:\s*https:\/\/soilhealth\.dac\.gov\.in\/fertilizer-dosage/i;
    const match = text.match(citationRegex);
    if (!match) return text;

    const citation = match[0].trim();
    const withoutCitation = text.replace(citationRegex, '').trim();
    return `${citation}\n\n${withoutCitation}`.trim();
  }

  private withLanguageInstruction(
    messages: BaseMessage[],
    preferredLanguage: ResponseLanguage,
    strict = false,
  ): BaseMessage[] {
    const instruction = this.getLanguageInstruction(preferredLanguage, strict);
    if (!instruction) return messages;
    return [...messages, new HumanMessage(instruction)];
  }

  private getLanguageInstruction(
    preferredLanguage: ResponseLanguage,
    strict: boolean,
  ): string {
    if (preferredLanguage === 'english') {
      return strict
        ? 'CRITICAL LANGUAGE RULE: Identify the ACTUAL SPOKEN LANGUAGE of the user. If the user is speaking an Indian language using English letters (e.g., Hinglish), you MUST reply in that Indian language using its native script (e.g., Hindi in Devanagari). If they are speaking pure English, reply in English.'
        : 'Language rule: Identify the spoken language. If Indian language in English letters, reply in its native script. If pure English, reply in English.';
    }
    if (preferredLanguage === 'devanagari') {
      return strict
        ? 'CRITICAL LANGUAGE RULE: Identify the ACTUAL SPOKEN LANGUAGE of the user. If the user wrote English words using Indian script letters, you MUST reply in English. Otherwise, reply in the same regional language and script.'
        : 'Language rule: Identify the spoken language. If English words in Indian script, reply in English. Otherwise, reply in the regional language and script.';
    }
    return '';
  }

  private detectPreferredLanguage(messages: BaseMessage[]): ResponseLanguage {
    const latestHuman = [...messages]
      .reverse()
      .find((msg) => msg._getType() === 'human');
    if (!latestHuman) return 'unknown';

    const text = this.messageContentToText(latestHuman.content);
    if (!text) return 'unknown';

    const indianChars = (text.match(/[\u0900-\u0D7F]/g) || []).length;
    const latinChars = (text.match(/[A-Za-z]/g) || []).length;

    if (latinChars > 0 && indianChars === 0) return 'english';
    if (indianChars > latinChars) return 'devanagari';
    return 'unknown';
  }

  private isLanguageMismatch(
    preferredLanguage: ResponseLanguage,
    reply: string,
  ): boolean {
    if (!reply) return false;
    if (preferredLanguage === 'english') {
      return /[\u0900-\u0D7F]/.test(reply);
    }
    return false;
  }

  private messageContentToText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((block: any) => block?.type === 'text')
        .map((block: any) => String(block.text ?? ''))
        .join(' ');
    }
    return '';
  }
}
