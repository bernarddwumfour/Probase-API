import { Transform } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { MAX_RADIUS_KM } from '../../../common/constants';
import { trim } from '../../../common/transforms';

export class SavedLocationInputDto {
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  address?: string;

  // Defaults to 2 km when omitted
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_RADIUS_KM)
  searchRadiusKm?: number;
}