import { Module } from '@nestjs/common';
import { FlowEncryptionService } from './flow-encryption.service';

@Module({
  providers: [FlowEncryptionService],
  exports: [FlowEncryptionService],
})
export class FlowEncryptionModule {}