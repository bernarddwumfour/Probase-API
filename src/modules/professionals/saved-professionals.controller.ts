import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import { SavedListQueryDto } from './dto/saved-list-query.dto';
import { SavedProfessionalsService } from './saved-professionals.service';

@ApiTags('professionals')
@ApiBearerAuth()
@RequireRole('customer')
@Controller('me/saved-professionals')
export class SavedProfessionalsController {
  constructor(private readonly saved: SavedProfessionalsService) {}

  @Get()
  list(@CurrentUser('id') userId: string, @Query() query: SavedListQueryDto) {
    return this.saved.list(userId, query);
  }

  @HttpCode(204)
  @Put(':id')
  async save(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.saved.save(userId, id);
  }

  @HttpCode(204)
  @Delete(':id')
  async remove(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.saved.remove(userId, id);
  }
}