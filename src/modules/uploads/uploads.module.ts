import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageService } from './storage/storage.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [PrismaModule],
  controllers: [UploadsController],
  providers: [StorageService, UploadsService],
  exports: [UploadsService, StorageService],
})
export class UploadsModule {}