import { Module } from '@nestjs/common';
import { SarvamService } from './sarvam.service';

@Module({
  providers: [SarvamService],
  exports: [SarvamService],
})
export class SarvamModule {}
