import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  UserDetailsModel,
  UserDetailsModelSchema,
} from './user-details.schema';
import { UserDetailsRepository } from './user-details.repository';
import { MongoUserDetailsRepository } from './mongo-user-details.repository';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      connectionName: 'USER_DETAILS_MONGO',
      useFactory: () => ({
        uri: process.env.USER_DETAILS_MONGO_URI,
      }),
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
