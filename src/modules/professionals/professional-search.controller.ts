import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import { GeoQueryDto } from './dto/geo-query.dto';
import { SearchProfessionalsDto } from './dto/search-professionals.dto';
import { ProfessionalSearchService } from './professional-search.service';

@ApiTags('professionals')
@ApiBearerAuth()
@RequireRole('customer')
@Controller('professionals')
export class ProfessionalSearchController {
  constructor(private readonly search: ProfessionalSearchService) {}

  @Get()
  list(@CurrentUser('id') userId: string, @Query() query: SearchProfessionalsDto) {
    return this.search.search(userId, query);
  }

  @Get(':id')
  profile(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: GeoQueryDto,
  ) {
    return this.search.getProfile(userId, id, query);
  }
}