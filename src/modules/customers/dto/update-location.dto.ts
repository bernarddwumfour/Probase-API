import { PartialType } from '@nestjs/swagger';
import { Equals, IsOptional } from 'class-validator';
import { SavedLocationInputDto } from './saved-location-input.dto';

export class UpdateLocationDto extends PartialType(SavedLocationInputDto) {
  @IsOptional()
  @Equals(true, {
    message: 'isDefault can only be set to true; make another location the default instead',
  })
  isDefault?: true;
}