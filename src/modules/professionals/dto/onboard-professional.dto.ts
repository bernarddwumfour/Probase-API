import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString,
  IsUUID, Length, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { MAX_RADIUS_KM } from '../../../common/constants';
import { trim } from '../../../common/transforms';
import { ServiceInputDto } from './service-input.dto';
import { WorkingDayInputDto } from './working-day-input.dto';

export class OnboardProfessionalDto {
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  businessName!: string;

  @IsUUID()
  professionId!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string;

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

  // Defaults to 5 km when omitted
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_RADIUS_KM)
  operationalRadiusKm?: number;

  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => WorkingDayInputDto)
  workingDays!: WorkingDayInputDto[];

  // Skippable
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ServiceInputDto)
  services?: ServiceInputDto[];
}