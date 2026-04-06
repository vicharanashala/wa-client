import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';
import { McpToolsService } from './mcp-tools.service';

/**
 * Manages a Gemini Live WebSocket session for a single call.
 * Handles setup, audio streaming, and tool calling.
 */

export interface GeminiLiveCallbacks {
  onAudio: (pcmBase64: string) => void;
  onText: (text: string) => void;
  onTurnComplete: () => void;
  onSetupComplete: () => void;
  onError: (error: string) => void;
  onClose: () => void;
}

@Injectable()
export class GeminiLiveService {
  private readonly logger = new Logger(GeminiLiveService.name);

  constructor(private readonly mcpTools: McpToolsService) {}

  /**
   * Create a new Gemini Live session for a call.
   * Returns an object to send audio and close the session.
   */
  createSession(callbacks: GeminiLiveCallbacks): GeminiLiveSession {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const session = new GeminiLiveSession(
      apiKey,
      this.mcpTools,
      callbacks,
      this.logger,
    );
    session.connect();
    return session;
  }
}

export class GeminiLiveSession {
  private ws: WebSocket | null = null;
  private isSetupComplete = false;

  constructor(
    private readonly apiKey: string,
    private readonly mcpTools: McpToolsService,
    private readonly callbacks: GeminiLiveCallbacks,
    private readonly logger: Logger,
  ) {}

  connect(): void {
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.logger.log('Connected to Gemini Live');
      this.sendSetup();
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(data);
    });

    this.ws.on('error', (err: Error) => {
      this.logger.error(`Gemini WS error: ${err.message}`);
      this.callbacks.onError(err.message);
    });

    this.ws.on('close', (code: number) => {
      this.logger.log(`Gemini WS closed: ${code}`);
      this.callbacks.onClose();
    });
  }

  private sendSetup(): void {
    const toolDeclarations = this.mcpTools.getToolDeclarations();

    const setupPayload: any = {
      setup: {
        model: 'models/gemini-2.5-flash-native-audio-latest',
        systemInstruction: {
          parts: [
            {
              text: 'You are a helpful assistant for Indian farmers. You have access to multiple tools for crop prices, weather, FAQs, and more. Use the appropriate tool when the user asks relevant questions. Keep answers short and crisp. Respond in the same language the user speaks.',
            },
          ],
        },
        generationConfig: { responseModalities: ['AUDIO'] },
      },
    };

    if (toolDeclarations.length > 0) {
      setupPayload.setup.tools = [
        { functionDeclarations: toolDeclarations },
      ];
    }

    this.ws?.send(JSON.stringify(setupPayload));
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const response = JSON.parse(data.toString());

      // Setup Complete
      if (response.setupComplete && !this.isSetupComplete) {
        this.isSetupComplete = true;
        this.logger.log('Gemini Live setup complete');
        this.callbacks.onSetupComplete();
      }

      // Audio/text response
      if (response.serverContent?.modelTurn) {
        const parts = response.serverContent.modelTurn.parts || [];
        for (const part of parts) {
          if (part.text) {
            this.logger.debug(`Gemini text: ${part.text.slice(0, 80)}`);
            this.callbacks.onText(part.text);
          }
          if (part.inlineData) {
            this.callbacks.onAudio(part.inlineData.data);
          }
        }
      }

      // Turn complete
      if (response.serverContent?.turnComplete) {
        this.callbacks.onTurnComplete();
      }

      // Tool call
      if (response.toolCall) {
        this.handleToolCall(response.toolCall);
      }
    } catch (err: any) {
      this.logger.error(`Failed to parse Gemini message: ${err.message}`);
    }
  }

  private async handleToolCall(toolCall: any): Promise<void> {
    const functionCall = toolCall.functionCalls[0];
    this.logger.log(`Tool triggered: ${functionCall.name}`);

    try {
      const result = await this.mcpTools.callTool(
        functionCall.name,
        functionCall.args,
      );

      this.ws?.send(
        JSON.stringify({
          toolResponse: {
            functionResponses: [
              {
                id: functionCall.id,
                name: functionCall.name,
                response: { result },
              },
            ],
          },
        }),
      );

      this.logger.log(`Tool response sent for: ${functionCall.name}`);
    } catch (error: any) {
      this.logger.error(`Tool call failed: ${error.message}`);
      this.ws?.send(
        JSON.stringify({
          toolResponse: {
            functionResponses: [
              {
                id: functionCall.id,
                name: functionCall.name,
                response: { error: error.message },
              },
            ],
          },
        }),
      );
    }
  }

  /**
   * Send PCM audio chunk (base64 encoded, 16kHz mono) to Gemini.
   */
  sendAudio(pcmBase64: string): void {
    if (!this.isSetupComplete || this.ws?.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        realtimeInput: {
          mediaChunks: [
            {
              mimeType: 'audio/pcm;rate=16000',
              data: pcmBase64,
            },
          ],
        },
      }),
    );
  }

  close(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    this.ws = null;
  }
}
