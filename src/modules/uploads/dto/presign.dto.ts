import { UploadPurpose } from '@prisma/client';
import { IsEnum, IsIn, IsInt, Max, Min } from 'class-validator';
import { ALL_CONTENT_TYPES, MAX_UPLOAD_BYTES } from '../upload.constants';

export class PresignDto {
  @IsEnum(UploadPurpose)
  purpose!: UploadPurpose;

  @IsIn(ALL_CONTENT_TYPES)
  contentType!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_UPLOAD_BYTES)
  sizeBytes!: number;
}