import { Body, Controller, Delete, Get, HttpCode, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { SetActiveRoleDto } from './dto/set-active-role.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UsersService } from './users.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  getMe(@CurrentUser('id') userId: string) {
    return this.users.getMe(userId);
  }

  @Patch()
  updateMe(@CurrentUser('id') userId: string, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(userId, dto);
  }

  @Put('active-role')
  setActiveRole(@CurrentUser('id') userId: string, @Body() dto: SetActiveRoleDto) {
    return this.users.setActiveRole(userId, dto.role);
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(204)
  @Delete()
  async deleteAccount(@CurrentUser('id') userId: string, @Body() dto: DeleteAccountDto) {
    await this.users.deleteAccount(userId, dto);
  }
}