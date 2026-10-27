import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../decorators/current-user.decorator';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

export const REQUIRED_ROLE_KEY = 'requiredRole';

@Injectable()
export class OnboardedRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Role>(REQUIRED_ROLE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true;

    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!req.user) {
      throw new AppException(401, ErrorCode.UNAUTHORIZED, 'Missing access token');
    }

    const where = { userId: req.user.id, onboardedAt: { not: null } };
    const profile =
      required === 'customer'
        ? await this.prisma.customerProfile.findFirst({ where, select: { id: true } })
        : await this.prisma.professionalProfile.findFirst({ where, select: { id: true } });

    if (!profile) {
      throw new AppException(
        403,
        ErrorCode.ROLE_NOT_ONBOARDED,
        `Complete ${required} onboarding to use this feature`,
        { role: required },
      );
    }
    return true;
  }
}