import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { SavedLocationInputDto } from './saved-location-input.dto';

export class OnboardCustomerDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  preferredProfessionIds!: string[];

  // Skippable. The first location becomes the default.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => SavedLocationInputDto)
  locations?: SavedLocationInputDto[];
}