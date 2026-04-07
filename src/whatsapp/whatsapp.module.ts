import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { WhatsappController } from './whatsapp.controller';
import { ConversationModule } from './conversations/conversation.module';
import { WhatsappService } from './whatsapp-api/whatsapp.service';
import { CallingModule } from './calling/calling.module';
import { PendingQuestionsModule } from './pending-questions/pending-questions.module';

@Module({
  imports: [CqrsModule, ConversationModule, CallingModule, PendingQuestionsModule],
  controllers: [WhatsappController],
  providers: [WhatsappService],
})
export class WhatsappModule {}

