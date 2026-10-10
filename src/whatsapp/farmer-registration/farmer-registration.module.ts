import { Module } from '@nestjs/common';
import { FarmerRegistrationService } from './farmer-registration.service';
import { FarmerRegistrationController } from './farmer-registration.controller';
import { LocationModule } from '../location/location.module';
import { LocationService } from '../location/location.service';
import { UserDetailsModule } from '../user-details/user-details.module';
import { WhatsappApiModule } from '../whatsapp-api/whatsapp-api.module';

@Module({
  imports: [
    LocationModule,
    UserDetailsModule,
    WhatsappApiModule,
  ],
  controllers: [FarmerRegistrationController],
  providers: [FarmerRegistrationService],
  exports: [FarmerRegistrationService, LocationService],
})
export class FarmerRegistrationModule {}