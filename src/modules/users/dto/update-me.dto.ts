import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, Matches ,IsUUID } from 'class-validator';

export const SUPPORTED_LANGUAGES = ['en'] as const;

export class UpdateMeDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 100)
  fullName?: string;

  // Send null to remove the number. Spaces and dashes are stripped first.
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const cleaned = value.replace(/[\s-]/g, '');
    return cleaned === '' ? null : cleaned;
  })
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'phone must be in international format, e.g. +233241234567',
  })
  phone?: string | null;

  @IsOptional()
  @IsIn(SUPPORTED_LANGUAGES)
  language?: string;

  @IsOptional()
  @IsUUID()
  avatarUploadId?: string | null;
}