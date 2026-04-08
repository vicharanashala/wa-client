import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { createAgent } from 'langchain';
import { AIMessage, BaseMessage, ToolMessage } from '@langchain/core/messages';
import { SYSTEM_PROMPT } from './system-prompt';


export interface LlmResult {
  reply: string;
  toolCalls: { toolCallId: string; toolName: string; input: string }[];
  toolResults: { toolCallId: string; toolName: string; result: string }[];
}


@Injectable()
export class LlmService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LlmService.name);

  private mcpClient: MultiServerMCPClient;
  private agent: ReturnType<typeof createAgent>;
  private tools: Awaited<ReturnType<MultiServerMCPClient['getTools']>> = [];

  async onModuleInit(): Promise<void> {
    this.mcpClient = new MultiServerMCPClient({
      mcpServers: {
        golden: {
          transport: 'http',
          url: 'http://100.100.108.44:9006/mcp',
        },
        // pop: {
        //   transport: 'http',
        //   url: 'http://100.100.108.43:9002/mcp',
        // },
        market: {
          transport: 'http',
          url: 'http://100.100.108.44:9002/mcp',
        },
        weather: {
          transport: 'http',
          url: 'http://100.100.108.44:9003/mcp',
        },
        'faq-videos': {
          transport: 'http',
          url: 'http://100.100.108.44:9005/mcp',
        },
        // reviewer_new: duplicate of reviewer, commented to avoid tool conflicts
        reviewer_new :{
          transport: 'http',
          url: 'http://100.100.108.44:9007/mcp',
        },
      },
      onConnectionError: 'ignore', // skip failed servers instead of crashing
    });

    this.tools = await this.mcpClient.getTools();
    this.logger.log(
      `Loaded ${this.tools.length} tools: ${this.tools.map((t) => t.name).join(', ')}`,
    );

    const baseUrl = process.env.LLM_BASE_URL || 'http://34.180.40.201:8081/v1';
    // Strip trailing /models if present (ChatOpenAI appends its own paths)
    const cleanBaseUrl = baseUrl.replace(/\/models\/?$/, '');

    this.agent = createAgent({
      model: new ChatOpenAI({
        modelName: process.env.LLM_MODEL === 'default' ? 'Qwen/Qwen3-30B-A3B' : (process.env.LLM_MODEL || 'Qwen/Qwen3-30B-A3B'),
        apiKey: process.env.LLM_API_KEY || 'dummy-key',
        configuration: {
          baseURL: cleanBaseUrl,
        },
        maxTokens: 4096,
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

  /**
   * Directly invoke an MCP tool by name, bypassing the LLM.
   * Used to force tool calls when the LLM doesn't cooperate.
   */
  async callTool(
    toolName: string,
    input: Record<string, any>,
  ): Promise<string> {
    const tool = this.tools.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(`Tool "${toolName}" not found among ${this.tools.length} loaded tools`);
    }
    this.logger.log(`🔧 Force-calling tool: ${toolName} with input: ${JSON.stringify(input)}`);
    const result = await tool.invoke(input);
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

async generate(messages: BaseMessage[]): Promise<LlmResult> {
  this.logger.log(`Sending ${messages.length} messages to LLM agent...`);

  let result: any;
  const MAX_RETRIES = 2;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      result = await this.agent.invoke({ messages });
      break; // success
    } catch (err: any) {
      const isEmptyOutputError =
        err?.message?.includes('model output must contain either output text or tool calls') ||
        err?.message?.includes('model output error');
      if (isEmptyOutputError && attempt < MAX_RETRIES) {
        this.logger.warn(`LLM returned empty output (attempt ${attempt}/${MAX_RETRIES}), retrying...`);
        continue;
      }
      // Last attempt or unrelated error — return safe fallback
      this.logger.error(`LLM agent failed after ${attempt} attempt(s): ${err.message}`);
      return {
        reply: 'मुझे अभी आपकी बात समझने में थोड़ी दिक्कत हो रही है। कृपया दोबारा कोशिश करें।',
        toolCalls: [],
        toolResults: [],
      };
    }
  }

  this.logger.log(`Agent returned ${result.messages?.length} messages`);

  const toolCalls: LlmResult['toolCalls'] = [];
  const toolResults: LlmResult['toolResults'] = [];
  let reply = '';

  for (const msg of result.messages) {
    // AIMessage with tool_calls = the LLM decided to call a tool
    if (msg._getType() === 'ai') { // Check type dynamically just in case instanceof fails
      const aiMsg = msg as AIMessage;
      if (aiMsg.tool_calls?.length || aiMsg.additional_kwargs?.tool_calls?.length) {
        this.logger.log(`🔧 Found tool calls in AI message!`);
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

  // ToolMessage = the tool returned a result
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

// Last AIMessage with text content is the final reply
const lastMsg = result.messages.findLast((m) => m._getType() === 'ai');
const content = lastMsg?.content;
if (typeof content === 'string') reply = content;
else if (Array.isArray(content)) {
  reply = content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

return { reply, toolCalls, toolResults };
}
}
