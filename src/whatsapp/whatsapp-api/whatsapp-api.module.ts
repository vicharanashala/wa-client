// whatsapp-api/whatsapp-api.module.ts
import { WhatsappService } from './whatsapp.service';
import { Module } from '@nestjs/common';

@Module({
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappApiModule {}
