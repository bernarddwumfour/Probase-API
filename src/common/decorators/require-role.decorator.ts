import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { OnboardedRoleGuard, REQUIRED_ROLE_KEY } from '../guards/onboarded-role.guard';

/** Usage: @RequireRole('professional') on a controller or a route. */
export const RequireRole = (role: Role) =>
  applyDecorators(SetMetadata(REQUIRED_ROLE_KEY, role), UseGuards(OnboardedRoleGuard));