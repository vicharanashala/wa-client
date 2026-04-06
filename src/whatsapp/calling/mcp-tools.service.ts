import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

/**
 * MCP Tool discovery and calling service for Gemini Live.
 * Discovers tools from all MCP servers and converts them to Gemini-compatible format.
 * Adapted from gemini-live-test/index.js
 */

interface GeminiToolDeclaration {
  name: string;
  description: string;
  parameters?: {
    type: string;
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
}

@Injectable()
export class McpToolsService implements OnModuleInit {
  private readonly logger = new Logger(McpToolsService.name);

  private readonly MCP_SERVERS: Record<string, string> = {
    golden: 'http://100.100.108.43:9006/mcp',
    pop: 'http://100.100.108.43:9002/mcp',
    market: 'http://100.100.108.43:9022/mcp',
    weather: 'http://100.100.108.43:9004/mcp',
    'faq-videos': 'http://100.100.108.43:9005/mcp',
    'golden-n': 'http://100.100.108.43:9023/mcp',
  };

  private toolToServer: Record<string, string> = {};
  private serverSessions: Record<string, string> = {};
  private allTools: GeminiToolDeclaration[] = [];

  async onModuleInit() {
    await this.discoverAllTools();
  }

  getToolDeclarations(): GeminiToolDeclaration[] {
    return this.allTools;
  }

  private parseSSEResponse(text: string): any {
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.substring(6).trim();
        if (jsonStr) return JSON.parse(jsonStr);
      }
    }
    return JSON.parse(text);
  }

  private async mcpRequest(
    serverUrl: string,
    method: string,
    params: Record<string, any> = {},
    isNotification = false,
  ): Promise<any> {
    const body: any = { jsonrpc: '2.0', method };
    if (!isNotification) body.id = Date.now();
    if (Object.keys(params).length > 0) body.params = params;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };

    if (this.serverSessions[serverUrl]) {
      headers['Mcp-Session-Id'] = this.serverSessions[serverUrl];
    }

    const res = await fetch(serverUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const sessionId = res.headers.get('mcp-session-id');
    if (sessionId) this.serverSessions[serverUrl] = sessionId;

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`MCP HTTP ${res.status}: ${errorText.substring(0, 200)}`);
    }

    if (isNotification) return null;

    const contentType = res.headers.get('content-type') || '';
    const responseText = await res.text();

    if (contentType.includes('text/event-stream') || responseText.startsWith('event:')) {
      return this.parseSSEResponse(responseText);
    }
    return JSON.parse(responseText);
  }

  private convertSchemaToGemini(schema: any): any {
    const result: any = {
      type: 'OBJECT',
      properties: {},
      required: schema.required || [],
    };

    for (const [key, val] of Object.entries(schema.properties || {})) {
      const v = val as any;
      result.properties[key] = {
        type: (v.type || 'string').toUpperCase(),
        description: v.description || '',
      };
      if (v.enum) result.properties[key].enum = v.enum;
    }
    return result;
  }

  async discoverAllTools(): Promise<GeminiToolDeclaration[]> {
    this.logger.log('Discovering tools from MCP servers...');
    const declarations: GeminiToolDeclaration[] = [];

    for (const [name, url] of Object.entries(this.MCP_SERVERS)) {
      try {
        await this.mcpRequest(url, 'initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'wa-calling-client', version: '1.0.0' },
        });

        try {
          await this.mcpRequest(url, 'notifications/initialized', {}, true);
        } catch {
          // non-fatal
        }

        const result = await this.mcpRequest(url, 'tools/list');
        const tools = result.result?.tools || result.tools || [];

        this.logger.log(`[${name}] → ${tools.length} tools`);

        for (const tool of tools) {
          this.toolToServer[tool.name] = url;
          const decl: GeminiToolDeclaration = {
            name: tool.name,
            description: tool.description || `Tool from ${name}`,
          };
          if (tool.inputSchema?.properties) {
            decl.parameters = this.convertSchemaToGemini(tool.inputSchema);
          }
          declarations.push(decl);
        }
      } catch (err: any) {
        this.logger.warn(`[${name}] Failed: ${err.message}`);
      }
    }

    this.allTools = declarations;
    this.logger.log(`Total tools discovered: ${declarations.length}`);
    return declarations;
  }

  async callTool(toolName: string, args: Record<string, any>): Promise<any> {
    const serverUrl = this.toolToServer[toolName];
    if (!serverUrl) throw new Error(`No MCP server for tool: ${toolName}`);

    this.logger.log(`Calling tool '${toolName}' on ${serverUrl}`);
    return this.mcpRequest(serverUrl, 'tools/call', {
      name: toolName,
      arguments: args,
    });
  }
}
