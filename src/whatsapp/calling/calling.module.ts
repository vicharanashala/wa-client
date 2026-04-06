import { Module } from '@nestjs/common';
import { CallingService } from './calling.service';
import { GeminiLiveService } from './gemini-live.service';
import { McpToolsService } from './mcp-tools.service';

@Module({
  providers: [CallingService, GeminiLiveService, McpToolsService],
  exports: [CallingService],
})
export class CallingModule {}
