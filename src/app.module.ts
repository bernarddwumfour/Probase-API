import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthModule } from './modules/health/health.module';
import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { AppLoggerModule } from './common/logging/logger.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './modules/users/users.module';
import { ProfessionsModule } from './modules/professions/professions.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ProfessionalsModule } from './modules/professionals/professionals.module';
import { UploadsModule } from './modules/uploads/uploads.module';



@Module({
  imports: [
    AppConfigModule, AppLoggerModule, PrismaModule, HealthModule,
    AuthModule, UsersModule, ProfessionsModule, CustomersModule, ProfessionalsModule,UploadsModule,    // ttl is in milliseconds: 60 requests per minute per IP by default
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule { }