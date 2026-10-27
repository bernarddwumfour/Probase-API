import { IsBoolean, IsOptional } from 'class-validator';
import { SavedLocationInputDto } from './saved-location-input.dto';

export class CreateLocationDto extends SavedLocationInputDto {
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}