import { Module } from '@nestjs/common';
import { LangGraphClientService } from './langgraph-client.service';
import { UserDetailsModule } from '../user-details/user-details.module';

@Module({
  imports: [UserDetailsModule],
  providers: [LangGraphClientService],
  exports: [LangGraphClientService],
})
export class LangGraphModule {}
