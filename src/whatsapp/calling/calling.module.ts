import { Module } from '@nestjs/common';
import { CallingService } from './calling.service';
import { GeminiLiveService } from './gemini-live.service';
import { McpToolsService } from './mcp-tools.service';
import { AudioCodecService } from './audio-codec.service';

@Module({
  providers: [CallingService, GeminiLiveService, McpToolsService, AudioCodecService],
  exports: [CallingService],
})
export class CallingModule {}
