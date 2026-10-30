import { Body, Controller, HttpCode, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PresignDto } from './dto/presign.dto';
import { StorageService } from './storage/storage.service';
import { UploadsService } from './uploads.service';

@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly storage: StorageService,
  ) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('presign')
  presign(@CurrentUser('id') userId: string, @Body() dto: PresignDto) {
    return this.uploads.presign(userId, dto);
  }

  // Development only: receives the file for the local storage driver. The signed URL is the credential.
  @ApiExcludeEndpoint()
  @Public()
  @HttpCode(204)
  @Put('local')
  async receiveLocal(
    @Query('key') key: string | undefined,
    @Query('exp') exp: string | undefined,
    @Query('size') size: string | undefined,
    @Query('type') type: string | undefined,
    @Query('sig') sig: string | undefined,
    @Req() req: Request,
  ) {
    await this.storage.receiveLocal({ key, exp, size, type, sig }, req);
  }
}