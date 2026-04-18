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
    'get_states',
    'get_districts',
    'get_crops',
    'get_fertilizer_dosage',
  ];

  private mcpClient: MultiServerMCPClient;
  private agent: ReturnType<typeof createAgent>;
  private tools: Awaited<ReturnType<MultiServerMCPClient['getTools']>> = [];

  async onModuleInit(): Promise<void> {
    this.mcpClient = new MultiServerMCPClient({
      mcpServers: {
        golden: {
          transport: 'http',
          url: 'http://100.100.108.43:9006/mcp',
        },
        pop: {
          transport: 'http',
          url: 'http://100.100.108.43:9002/mcp',
        },
        market: {
          transport: 'http',
          url: 'http://100.100.108.43:9022/mcp',
        },
        weather: {
          transport: 'http',
          url: 'http://100.100.108.43:9004/mcp',
        },
        'faq-videos': {
          transport: 'http',
          url: 'http://100.100.108.43:9005/mcp',
        },
        soilhealth: {
          transport: 'http',
          url: process.env.MCP_SOILHEALTH_URL || 'http://100.100.108.44:9008/mcp',
        },
        reviewer_new: {
          transport: 'http',
          url: 'http://100.100.108.44:9007/mcp',
        },
      },
      onConnectionError: 'ignore',
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
      tools: this.tools,
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

    parsed.reply = this.normalizeWhatsappFormatting(parsed.reply);
    parsed.reply = this.promoteSoilCitationToTop(parsed.reply);
    parsed.reply = this.appendReviewerNotification(parsed, preferredLanguage);
    return parsed;
  }

  private appendReviewerNotification(parsed: LlmResult, preferredLanguage: ResponseLanguage): string {
    const calledReviewer = parsed.toolCalls.some(tc => tc.toolName === 'upload_question_to_reviewer_system') || 
                           parsed.toolResults.some(tr => tr.toolName === 'upload_question_to_reviewer_system');

    let reply = parsed.reply;
    if (calledReviewer) {
      let msg = '';
      if (reply.match(/[\u0A00-\u0A7F]/)) {
        msg = 'ਤੁਹਾਡਾ ਸੁਨੇਹਾ ਖੇਤੀਬਾੜੀ ਮਾਹਰ (Agriculture Expert) ਨੂੰ ਭੇਜ ਦਿੱਤਾ ਗਿਆ ਹੈ। ਤੁਹਾਨੂੰ ਜਲਦੀ ਹੀ ਇੱਕ ਜਵਾਬ ਮਿਲੇਗਾ।';
      } else if (reply.match(/[\u0A80-\u0AFF]/)) {
        msg = 'તમારો પ્રશ્ન કૃષિ નિષ્ણાત (Agriculture Expert) ને મોકલવામાં આવ્યો છે. તમને ટૂંક સમયમાં જ એક જવાબ મળશે.';
      } else if (reply.match(/[\u0980-\u09FF]/)) {
        msg = 'আপনার বার্তা কৃষি বিশেষজ্ঞের (Agriculture Expert) কাছে পাঠানো হয়েছে। আপনি শীঘ্রই একটি উত্তর পাবেন।';
      } else if (reply.match(/[\u0B80-\u0BFF]/)) {
        msg = 'உங்கள் செய்தி வேளாண் நிபுணருக்கு (Agriculture Expert) அனுப்பப்பட்டுள்ளது. விரைவில் உங்களுக்கு பதில் கிடைக்கும்.';
      } else if (reply.match(/[\u0C00-\u0C7F]/)) {
        msg = 'మీ సందేశం వ్యవసాయ నిపుణులకు (Agriculture Expert) పంపబడింది. మీరు త్వరలో సమాధానం అందుకుంటారు.';
      } else if (reply.match(/[\u0C80-\u0CFF]/)) {
        msg = 'ನಿಮ್ಮ ಸಂದೇಶವನ್ನು ಕೃಷಿ ತಜ್ಞರಿಗೆ (Agriculture Expert) ಕಳುಹಿಸಲಾಗಿದೆ. ನೀವು ಶೀಘ್ರದಲ್ಲೇ ಉತ್ತರವನ್ನು ಪಡೆಯುತ್ತೀರಿ.';
      } else if (reply.match(/[\u0D00-\u0D7F]/)) {
        msg = 'നിങ്ങളുടെ സന്ദേശം കൃഷി വിദഗ്ദ്ധന് (Agriculture Expert) അയച്ചിട്ടുണ്ട്. നിങ്ങൾക്ക് ഉടൻ തന്നെ മറുപടി ലഭിക്കും.';
      } else if (reply.match(/[\u0B00-\u0B7F]/)) {
        msg = 'ଆପଣଙ୍କର ବାର୍ତ୍ତା କୃଷି ବିଶେଷଜ୍ଞଙ୍କ (Agriculture Expert) ନିକଟକୁ ପଠାଯାଇଛି | ଆପଣ ଶୀଘ୍ର ଏକ ଉତ୍ତର ପାଇବେ |';
      } else if (reply.match(/[\u0900-\u097F]/)) {
        msg = 'आपका प्रश्न कृषि विशेषज्ञ (Agriculture Expert) को भेज दिया गया है। आपको जल्द ही इसका उत्तर मिलेगा।';
      } else {
        msg = 'Your message has been forwarded to the Agriculture Expert. You will receive a response shortly.';
      }
      
      const disclaimer = '⚠️ This is a testing version. Please consult an expert before making farming decisions.';
      if (reply.includes(disclaimer)) {
        reply = reply.replace(disclaimer, `${msg}\n\n${disclaimer}`);
      } else {
        reply = `${reply}\n\n${msg}`;
      }
    }
    return reply;
  }

  private async invokeAgentWithRetry(messages: BaseMessage[]): Promise<any | null> {
    let result: any;
    const maxRetries = 2;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        result = await this.agent.invoke({ messages });
        return result;
      } catch (err: any) {
        const isEmptyOutputError =
          err?.message?.includes('model output must contain either output text or tool calls') ||
          err?.message?.includes('model output error');
        if (isEmptyOutputError && attempt < maxRetries) {
          this.logger.warn(`LLM returned empty output (attempt ${attempt}/${maxRetries}), retrying...`);
          continue;
        }
        this.logger.error(`LLM agent failed after ${attempt} attempt(s)`);
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
        ? 'CRITICAL LANGUAGE RULE: Reply in English only. Do not use Hindi or any regional Indian script anywhere in the reply.'
        : 'Language rule: reply fully in English only.';
    }
    if (preferredLanguage === 'devanagari') {
      return strict
        ? 'CRITICAL LANGUAGE RULE: Reply only in the same regional language/script as the user. Do not switch to English paragraphs.'
        : 'Language rule: reply in the same regional script as the user.';
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
