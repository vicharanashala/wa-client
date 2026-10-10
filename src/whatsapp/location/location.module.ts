import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LocationService } from './location.service';

@Module({
  imports: [ConfigModule],
  providers: [LocationService],
  exports: [LocationService],
})
export class LocationModule {}