import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { ProfessionalSearchController } from './professional-search.controller';
import { ProfessionalSearchService } from './professional-search.service';
import { ProfessionalsController } from './professionals.controller';
import { ProfessionalsService } from './professionals.service';
import { SavedProfessionalsController } from './saved-professionals.controller';
import { SavedProfessionalsService } from './saved-professionals.service';

@Module({
  imports: [PrismaModule, UsersModule],
  controllers: [
    ProfessionalsController,
    ProfessionalSearchController,
    SavedProfessionalsController,
  ],
  providers: [ProfessionalsService, ProfessionalSearchService, SavedProfessionalsService],
})
export class ProfessionalsModule {}