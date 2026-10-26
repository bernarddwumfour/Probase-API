import { Role } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class SetActiveRoleDto {
  @IsEnum(Role)
  role!: Role;
}