import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OnboardProfessionalDto } from './dto/onboard-professional.dto';
import { ProfessionalsService } from './professionals.service';

@ApiTags('professional')
@ApiBearerAuth()
@Controller('me/professional-profile')
export class ProfessionalsController {
  constructor(private readonly professionals: ProfessionalsService) {}

  @Post()
  onboard(@CurrentUser('id') userId: string, @Body() dto: OnboardProfessionalDto) {
    return this.professionals.onboard(userId, dto);
  }
}