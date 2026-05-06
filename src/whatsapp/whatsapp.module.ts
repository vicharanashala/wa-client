import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { WhatsappController } from './whatsapp.controller';
import { ConversationModule } from './conversations/conversation.module';
import { WhatsappService } from './whatsapp-api/whatsapp.service';
import { PendingQuestionsModule } from './pending-questions/pending-questions.module';
import { CallingModule } from './calling/calling.module';
import { AccessControlModule } from './access-control/access-control.module';

@Module({
  imports: [CqrsModule, ConversationModule, PendingQuestionsModule, CallingModule, AccessControlModule],
  controllers: [WhatsappController],
  providers: [WhatsappService],
})
export class WhatsappModule {}

