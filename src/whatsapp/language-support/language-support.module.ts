import { Module } from '@nestjs/common';
import { LanguageSupportService } from './language-support.service';

@Module({
  providers: [LanguageSupportService],
  exports: [LanguageSupportService],
})
export class LanguageSupportModule {}
