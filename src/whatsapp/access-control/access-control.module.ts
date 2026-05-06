import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WhitelistModel, WhitelistModelSchema } from './whitelist.schema';
import { BlacklistModel, BlacklistModelSchema } from './blacklist.schema';
import { AccessControlService } from './access-control.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WhitelistModel.name, schema: WhitelistModelSchema },
      { name: BlacklistModel.name, schema: BlacklistModelSchema },
    ]),
  ],
  providers: [AccessControlService],
  exports: [AccessControlService],
})
export class AccessControlModule {}
