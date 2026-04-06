import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  try {
    const app = await NestFactory.create(AppModule, {
      rawBody: true,
      logger: process.env.NODE_ENV === 'production' 
        ? ['error', 'warn', 'log']
        : ['error', 'warn', 'log', 'debug', 'verbose'],
    });

    // Global validation pipe
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        disableErrorMessages: process.env.NODE_ENV === 'production',
      }),
    );

    // Enable shutdown hooks
    app.enableShutdownHooks();

    const port = process.env.PORT || 3000;
    await app.listen(port);
    
    logger.log(`🚀 Application is running on: http://localhost:${port}`);
    logger.log(`📱 WhatsApp webhook: http://localhost:${port}/whatsapp/webhook`);
    logger.log(`🏥 Health check: http://localhost:${port}/whatsapp/health`);
    
    // Log environment info
    logger.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.log(`🧠 LLM Base URL: ${process.env.LLM_BASE_URL || 'http://localhost:8000/v1'}`);
    logger.log(`🗄️  MongoDB: ${process.env.MONGO_URI ? '✅ Configured' : '❌ Not configured'}`);
    logger.log(`🚀 Redis: ${process.env.REDIS_HOST ? '✅ Configured' : '❌ Not configured'}`);
    logger.log(`📞 WhatsApp: ${process.env.META_ACCESS_TOKEN ? '✅ Configured' : '❌ Not configured'}`);
    
  } catch (error) {
    logger.error('Failed to start application', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

bootstrap();