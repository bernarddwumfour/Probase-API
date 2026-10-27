import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ProfessionsService } from './professions.service';

@ApiTags('professions')
@ApiBearerAuth()
@Controller('professions')
export class ProfessionsController {
  constructor(private readonly professions: ProfessionsService) {}

  @Get()
  list() {
    return this.professions.list();
  }
}