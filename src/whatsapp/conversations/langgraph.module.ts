import { Module } from '@nestjs/common';
import { LangGraphClientService } from './langgraph-client.service';

@Module({
  providers: [LangGraphClientService],
  exports: [LangGraphClientService],
})
export class LangGraphModule {}
