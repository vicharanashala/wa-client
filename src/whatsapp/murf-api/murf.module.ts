import { Module } from '@nestjs/common';
import { MurfService } from './murf.service';

@Module({
  providers: [MurfService],
  exports: [MurfService],
})
export class MurfModule {}
