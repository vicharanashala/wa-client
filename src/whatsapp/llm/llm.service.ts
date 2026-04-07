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

  async onModuleInit(): Promise<void> {
    this.mcpClient = new MultiServerMCPClient({
      mcpServers: {
        reviewer: {
          transport: 'http',
          url: 'http://100.100.108.44:9002/mcp',
        },
        golden: {
          transport: 'http',
          url: 'http://100.100.108.44:9003/mcp',
        },
        pop: {
          transport: 'http',
          url: 'http://100.100.108.44:9005/mcp',
        },
        market: {
          transport: 'http',
          url: 'http://100.100.108.44:9006/mcp',
        },
        weather: {
          transport: 'http',
          url: 'http://100.100.108.44:9007/mcp',
        },
      },
      onConnectionError: 'ignore', // skip failed servers instead of crashing
    });

    const tools = await this.mcpClient.getTools();
    this.logger.log(
      `Loaded ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`,
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
        maxTokens: 1024,
      }),
      tools,
      systemPrompt: SYSTEM_PROMPT
    });

    this.logger.log('LLM agent initialized');
  }

  async onModuleDestroy(): Promise<void> {
    await this.mcpClient.close();
    this.logger.log('MCP client closed');
  }

async generate(messages: BaseMessage[]): Promise<LlmResult> {
  const result = await this.agent.invoke({ messages });

  const toolCalls: LlmResult['toolCalls'] = [];
const toolResults: LlmResult['toolResults'] = [];
let reply = '';

for (const msg of result.messages) {
  // AIMessage with tool_calls = the LLM decided to call a tool
  if (msg instanceof AIMessage && msg.tool_calls?.length) {
    const aiMsg = msg as AIMessage;
    for (const tc of aiMsg.tool_calls ?? []) {
      toolCalls.push({
        toolCallId: tc.id!,
        toolName: tc.name,
        input: JSON.stringify(tc.args),
      });
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
