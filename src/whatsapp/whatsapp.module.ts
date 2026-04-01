import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { WhatsappController } from './whatsapp.controller';
import { ConversationModule } from './conversations/conversation.module';
import { WhatsappService } from './whatsapp-api/whatsapp.service';

@Module({
  imports: [CqrsModule, ConversationModule],
  controllers: [WhatsappController],
  providers: [WhatsappService],
})
export class WhatsappModule {}
