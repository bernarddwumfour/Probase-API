import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import type { Role } from '@prisma/client';
import type { Env } from '../../../config/env.schema';

export interface AccessPayload {
  sub: string;
  role: Role | null; // a hint only; always authorise from the database
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  signAccessToken(user: { id: string; activeRole: Role | null }): Promise<string> {
    return this.jwt.signAsync(
      { role: user.activeRole },
      {
        subject: user.id,
        algorithm: 'HS256',
        expiresIn: this.config.get('JWT_ACCESS_TTL', {
          infer: true,
        }) as JwtSignOptions['expiresIn'],
      },
    );
  }

  verifyAccessToken(token: string): Promise<AccessPayload> {
    return this.jwt.verifyAsync<AccessPayload>(token, { algorithms: ['HS256'] });
  }

  // Opaque, 384 bits of randomness. Only its hash is stored in the database.
  generateRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  // SHA-256 is enough for high-entropy random tokens (no slow hash needed)
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  newFamilyId(): string {
    return randomUUID();
  }

  refreshExpiry(): Date {
    const days = this.config.get('REFRESH_TTL_DAYS', { infer: true });
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }
}