import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FarmerRegistrationService } from './farmer-registration.service';
import { FarmerRegistrationController } from './farmer-registration.controller';
import { LocationModule } from '../location/location.module';
import { UserDetailsModule } from '../user-details/user-details.module';
import { WhatsappApiModule } from '../whatsapp-api/whatsapp-api.module';
import { FlowEncryptionModule } from '../flow-encryption/flow-encryption.module';
import {
  FlowSubmissionModel,
  FlowSubmissionSchema,
} from './flow-submission.schema';
import { FlowSubmissionRepository } from './flow-submission.repository';
import { MongoFlowSubmissionRepository } from './mongo-flow-submission.repository';

@Module({
  imports: [
    LocationModule,
    UserDetailsModule,
    WhatsappApiModule,
    FlowEncryptionModule,
    // Flow submissions collection (uses default MongoDB connection)
    MongooseModule.forFeature([
      { name: FlowSubmissionModel.name, schema: FlowSubmissionSchema },
    ]),
  ],
  controllers: [FarmerRegistrationController],
  providers: [
    FarmerRegistrationService,
    {
      provide: FlowSubmissionRepository,
      useClass: MongoFlowSubmissionRepository,
    },
  ],
  exports: [FarmerRegistrationService, FlowEncryptionModule, FlowSubmissionRepository],
})
export class FarmerRegistrationModule {}