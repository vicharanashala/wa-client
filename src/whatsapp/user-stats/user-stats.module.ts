import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  WhatsappUserModel,
  WhatsappUserModelSchema,
} from './whatsapp-user.schema';
import { WhatsappUserRepository } from './whatsapp-user.repository';
import { MongoWhatsappUserRepository } from './mongo-whatsapp-user.repository';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WhatsappUserModel.name, schema: WhatsappUserModelSchema },
    ]),
  ],
  providers: [
    {
      provide: WhatsappUserRepository,
      useClass: MongoWhatsappUserRepository,
    },
  ],
  exports: [WhatsappUserRepository],
})
export class UserStatsModule {}
