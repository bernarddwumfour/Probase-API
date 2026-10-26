import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TokenExpiredError } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AuthUser } from '../../../common/decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPayload, TokenService } from '../services/token.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const [type, token] = req.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) {
      throw new AppException(401, ErrorCode.UNAUTHORIZED, 'Missing access token');
    }

    let payload: AccessPayload;
    try {
      payload = await this.tokens.verifyAccessToken(token);
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        throw new AppException(401, ErrorCode.TOKEN_EXPIRED, 'Access token expired');
      }
      throw new AppException(401, ErrorCode.UNAUTHORIZED, 'Invalid access token');
    }

    // The token only proves who they were at login; the database decides now
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, activeRole: true, status: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      throw new AppException(401, ErrorCode.UNAUTHORIZED, 'Invalid access token');
    }
    if (user.status !== 'active') {
      throw new AppException(403, ErrorCode.ACCOUNT_SUSPENDED, 'Account suspended');
    }

    req.user = { id: user.id, role: user.activeRole };
    return true;
  }
}