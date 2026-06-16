import { Module, Logger } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  UserDetailsModel,
  UserDetailsModelSchema,
} from './user-details.schema';
import { UserDetailsRepository } from './user-details.repository';
import { MongoUserDetailsRepository } from './mongo-user-details.repository';

const logger = new Logger('UserDetailsModule');

@Module({
  imports: [
    MongooseModule.forRootAsync({
      connectionName: 'USER_DETAILS_MONGO',
      useFactory: () => {
        const uri = process.env.USER_DETAILS_MONGO_URI || process.env.MONGO_URI;
        if (!process.env.USER_DETAILS_MONGO_URI) {
          logger.warn(
            'USER_DETAILS_MONGO_URI not set, falling back to MONGO_URI. ' +
            'Set USER_DETAILS_MONGO_URI for separate user_details database connection.',
          );
        }
        if (!uri) {
          logger.warn(
            'No MongoDB URI available for user_details. ' +
            'Daily thread context will not include last_rephrased_query.',
          );
        }
        return { uri: uri || '' };
      },
    }),
    MongooseModule.forFeature(
      [{ name: UserDetailsModel.name, schema: UserDetailsModelSchema }],
      'USER_DETAILS_MONGO',
    ),
  ],
  providers: [
    {
      provide: UserDetailsRepository,
      useClass: MongoUserDetailsRepository,
    },
  ],
  exports: [UserDetailsRepository],
})
export class UserDetailsModule {}
