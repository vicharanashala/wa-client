import { Module } from '@nestjs/common';
import { FFVService } from './ffv-service';
import { FFVController } from './ffv.controller';

@Module({
  providers: [FFVService],
  controllers: [FFVController],
  exports: [FFVService],
})
export class FarmerFriendlyModule {}