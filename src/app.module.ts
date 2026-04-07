import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import configuration from './config/configuration';
import { validateConfig } from './config/validate-config';
import { AppConfigService } from './config/app-config.service';

@Module({
  imports: [
    // Configure NestJS ConfigModule with YAML configuration
    ConfigModule.forRoot({
      load: [configuration],
      validate: validateConfig,
      isGlobal: true, // Makes ConfigService available everywhere
      cache: true, // Cache configuration for performance
    }),
    // Configure MongoDB with URI from environment variables
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: process.env.MONGO_URI || '',
        ...configService.get('database.mongodb.options'),
      }),
      inject: [ConfigService],
    }),
    WhatsappModule,
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppModule {}
