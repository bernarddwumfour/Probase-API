import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { Env } from './config/env.schema';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { configureApp } from './app.setup';
import { StorageService } from './modules/uploads/storage/storage.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const isProd = config.get('NODE_ENV', { infer: true }) === 'production';

  // Behind a load balancer, this makes req.ip (and rate limiting) use the real client IP
  if (isProd) app.set('trust proxy', 1);

  app.enableShutdownHooks();
  configureApp(app);

  // CSP is off outside production so Swagger UI's inline scripts work
    app.use(
    helmet({
      contentSecurityPolicy: isProd ? undefined : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // images are loaded cross-origin
    }),
  );

  const localPublicDir = app.get(StorageService).localPublicDir;
  if (localPublicDir) app.useStaticAssets(localPublicDir, { prefix: '/files' });

  const origins = config.get('CORS_ORIGINS', { infer: true });
  app.enableCors({
    origin: origins.length ? origins : false,
    exposedHeaders: ['x-request-id'],
  });

  

  if (!isProd) {
    const doc = new DocumentBuilder()
      .setTitle('ProBase API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc), {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(config.get('PORT', { infer: true }));
}
bootstrap();