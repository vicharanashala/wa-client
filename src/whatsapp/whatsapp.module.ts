import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';
import { WhatsappController } from './whatsapp.controller';
import { ProcessWhatsappMessageHandler } from './commands/process-whatsapp-message.handler';
import { CacheService } from './services/cache.service';
import { DatabaseService } from './services/database.service';
import { LlmService } from './services/llm.service';
import { WhatsappOutboundService } from './services/whatsapp-outbound.service';
import { Conversation, ConversationSchema } from './schemas/conversation.schema';

const CommandHandlers = [ProcessWhatsappMessageHandler];

@Module({
  imports: [
    CqrsModule,
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
    ]),
  ],
  controllers: [WhatsappController],
  providers: [
    ...CommandHandlers,
    CacheService,
    DatabaseService,
    LlmService,
    WhatsappOutboundService,
  ],
})
export class WhatsappModule {}