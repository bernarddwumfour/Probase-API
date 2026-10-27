import { IsBoolean, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { TIME_RE } from '../working-days.util';

export class WorkingDayInputDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @IsBoolean()
  isOpen!: boolean;

  @IsOptional()
  @Matches(TIME_RE, { message: 'opensAt must be in HH:mm 24-hour format' })
  opensAt?: string | null;

  @IsOptional()
  @Matches(TIME_RE, { message: 'closesAt must be in HH:mm 24-hour format' })
  closesAt?: string | null;
}