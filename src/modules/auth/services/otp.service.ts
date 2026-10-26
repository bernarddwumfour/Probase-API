import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpPurpose } from '@prisma/client';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import type { Env } from '../../../config/env.schema';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private hash(userId: string, purpose: OtpPurpose, code: string): string {
    return createHmac('sha256', this.config.get('JWT_ACCESS_SECRET', { infer: true }))
      .update(`${userId}:${purpose}:${code}`)
      .digest('hex');
  }

  private generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  /** Creates a new code and returns the plain value, to be emailed. Never stored. */
  async issue(userId: string, purpose: OtpPurpose): Promise<string> {
    const cooldown = this.config.get('OTP_RESEND_COOLDOWN_SECONDS', { infer: true });
    const ttlMin = this.config.get('OTP_TTL_MINUTES', { infer: true });

    const latest = await this.prisma.otpCode.findFirst({
      where: { userId, purpose },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && cooldown > 0) {
      const elapsed = (Date.now() - latest.createdAt.getTime()) / 1000;
      if (elapsed < cooldown) {
        throw new AppException(
          429,
          ErrorCode.OTP_RESEND_TOO_SOON,
          'Please wait before requesting another code',
          { retryAfterSeconds: Math.ceil(cooldown - elapsed) },
        );
      }
    }

    const code = this.generateCode();
    await this.prisma.$transaction([
      // Invalidate any earlier codes so only the newest one works
      this.prisma.otpCode.updateMany({
        where: { userId, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.otpCode.create({
        data: {
          userId,
          purpose,
          codeHash: this.hash(userId, purpose, code),
          expiresAt: new Date(Date.now() + ttlMin * 60_000),
        },
      }),
    ]);
    return code;
  }

  /** Resolves if the code is valid and consumes it. Throws an AppException otherwise. */
  async verify(userId: string, purpose: OtpPurpose, code: string): Promise<void> {
    const max = this.config.get('OTP_MAX_ATTEMPTS', { infer: true });
    const invalid = () =>
      new AppException(400, ErrorCode.OTP_INVALID, 'The code is incorrect');
    const exceeded = () =>
      new AppException(
        429,
        ErrorCode.OTP_ATTEMPTS_EXCEEDED,
        'Too many attempts. Request a new code',
      );

    const otp = await this.prisma.otpCode.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw invalid();
    if (otp.expiresAt <= new Date()) {
      throw new AppException(400, ErrorCode.OTP_EXPIRED, 'The code has expired');
    }
    if (otp.attempts >= max) throw exceeded();

    // Count the attempt before comparing; concurrent guesses can't dodge the limit
    const { attempts } = await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    if (attempts > max) throw exceeded();

    const expected = Buffer.from(otp.codeHash, 'hex');
    const actual = Buffer.from(this.hash(userId, purpose, code), 'hex');
    if (!timingSafeEqual(expected, actual)) throw invalid();

    // Atomic consume: if two requests race with the right code, only one wins
    const { count } = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (count !== 1) throw invalid();
  }
}