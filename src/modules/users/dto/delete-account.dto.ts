import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeleteAccountDto {
  // Required for accounts that have a password
  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string;
}