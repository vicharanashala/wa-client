import { Module } from '@nestjs/common';
import { ScriptDetectionService } from './script-detection.service';
import { LanguageSupportModule } from '../language-support/language-support.module';

@Module({
  imports: [LanguageSupportModule],
  providers: [ScriptDetectionService],
  exports: [ScriptDetectionService],
})
export class ScriptDetectionModule {}
