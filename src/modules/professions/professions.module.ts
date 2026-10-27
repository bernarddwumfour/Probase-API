import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProfessionsController } from './professions.controller';
import { ProfessionsService } from './professions.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProfessionsController],
  providers: [ProfessionsService],
})
export class ProfessionsModule {}