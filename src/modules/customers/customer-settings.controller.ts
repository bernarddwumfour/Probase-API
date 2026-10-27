import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import { CustomerSettingsService } from './customer-settings.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { SetPreferredProfessionsDto } from './dto/set-preferred-professions.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@ApiTags('customer')
@ApiBearerAuth()
@RequireRole('customer')
@Controller('me')
export class CustomerSettingsController {
  constructor(private readonly settings: CustomerSettingsService) {}

  @Get('locations')
  list(@CurrentUser('id') userId: string) {
    return this.settings.listLocations(userId);
  }

  @Post('locations')
  create(@CurrentUser('id') userId: string, @Body() dto: CreateLocationDto) {
    return this.settings.createLocation(userId, dto);
  }

  @Patch('locations/:id')
  update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.settings.updateLocation(userId, id, dto);
  }

  @HttpCode(204)
  @Delete('locations/:id')
  async remove(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.settings.deleteLocation(userId, id);
  }

  @Put('preferred-professions')
  setPreferred(@CurrentUser('id') userId: string, @Body() dto: SetPreferredProfessionsDto) {
    return this.settings.setPreferredProfessions(userId, dto);
  }
}