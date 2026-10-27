import { Transform } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { trim } from '../../../common/transforms';

export class ServiceInputDto {
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  rate!: number;

  @IsIn(['hr', 'job', 'day'])
  unit!: 'hr' | 'job' | 'day';
}