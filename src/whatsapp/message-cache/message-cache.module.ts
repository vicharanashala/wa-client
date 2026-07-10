import { Module, Global } from '@nestjs/common';
import { MessageCacheService } from './message-cache.service';

@Global()
@Module({
  providers: [MessageCacheService],
  exports: [MessageCacheService],
})
export class MessageCacheModule {}