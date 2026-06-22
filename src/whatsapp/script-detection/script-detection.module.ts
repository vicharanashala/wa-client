import { Module } from '@nestjs/common';
import { ScriptDetectionService } from './script-detection.service';

@Module({
  providers: [ScriptDetectionService],
  exports: [ScriptDetectionService],
})
export class ScriptDetectionModule {}
