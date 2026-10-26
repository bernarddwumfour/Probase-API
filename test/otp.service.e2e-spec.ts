import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppException } from '../src/common/errors/app.exception';
import type { Env } from '../src/config/env.schema';
import { OtpService } from '../src/modules/auth/services/otp.service';
import { PrismaService } from '../src/prisma/prisma.service';

const config = (cooldown: number) =>
  ({
    get: (k: string) =>
      (
        {
          JWT_ACCESS_SECRET: 'x'.repeat(40),
          OTP_TTL_MINUTES: 10,
          OTP_MAX_ATTEMPTS: 5,
          OTP_RESEND_COOLDOWN_SECONDS: cooldown,
        } as Record<string, unknown>
      )[k],
  }) as unknown as ConfigService<Env, true>;

describe('OtpService (database)', () => {
  const prisma = new PrismaService();
  const otp = new OtpService(prisma, config(0));
  const otpWithCooldown = new OtpService(prisma, config(60));
  let userId: string;

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "users" CASCADE');
    userId = (await prisma.user.create({ data: { fullName: 'T', email: 'otp@example.com' } })).id;
  });

  const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');

  it('issues a 6-digit code and stores only a hash', async () => {
    const code = await otp.issue(userId, 'email_verify');
    expect(code).toMatch(/^\d{6}$/);
    const row = await prisma.otpCode.findFirstOrThrow({ where: { userId } });
    expect(row.codeHash).toHaveLength(64);
    expect(row.codeHash).not.toBe(code);
  });

  it('accepts the right code once and rejects reuse', async () => {
    const code = await otp.issue(userId, 'email_verify');
    await expect(otp.verify(userId, 'email_verify', code)).resolves.toBeUndefined();
    await expect(otp.verify(userId, 'email_verify', code)).rejects.toHaveProperty(
      'code',
      'OTP_INVALID',
    );
  });

  it('rejects a wrong code', async () => {
    const code = await otp.issue(userId, 'email_verify');
    await expect(otp.verify(userId, 'email_verify', wrongCode(code))).rejects.toHaveProperty(
      'code',
      'OTP_INVALID',
    );
  });

  it('locks the code after 5 wrong attempts, even for the right code', async () => {
    const code = await otp.issue(userId, 'email_verify');
    for (let i = 0; i < 5; i++) {
      await expect(otp.verify(userId, 'email_verify', wrongCode(code))).rejects.toHaveProperty(
        'code',
        'OTP_INVALID',
      );
    }
    await expect(otp.verify(userId, 'email_verify', wrongCode(code))).rejects.toHaveProperty(
      'code',
      'OTP_ATTEMPTS_EXCEEDED',
    );
    await expect(otp.verify(userId, 'email_verify', code)).rejects.toHaveProperty(
      'code',
      'OTP_ATTEMPTS_EXCEEDED',
    );
  });

  it('rejects an expired code', async () => {
    const code = await otp.issue(userId, 'email_verify');
    await prisma.otpCode.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(otp.verify(userId, 'email_verify', code)).rejects.toHaveProperty(
      'code',
      'OTP_EXPIRED',
    );
  });

  it('invalidates the older code when a new one is issued', async () => {
    const first = await otp.issue(userId, 'email_verify');
    const second = await otp.issue(userId, 'email_verify');
    if (first !== second) {
      await expect(otp.verify(userId, 'email_verify', first)).rejects.toHaveProperty(
        'code',
        'OTP_INVALID',
      );
    }
    await expect(otp.verify(userId, 'email_verify', second)).resolves.toBeUndefined();
  });

  it('does not let a code for one purpose work for another', async () => {
    const code = await otp.issue(userId, 'email_verify');
    await expect(otp.verify(userId, 'password_reset', code)).rejects.toHaveProperty(
      'code',
      'OTP_INVALID',
    );
  });

  it('enforces the resend cooldown and reports the wait time', async () => {
    await otpWithCooldown.issue(userId, 'email_verify');
    const err = (await otpWithCooldown
      .issue(userId, 'email_verify')
      .then(() => null, (e: unknown) => e)) as AppException;
    expect(err).toBeInstanceOf(AppException);
    expect(err.code).toBe('OTP_RESEND_TOO_SOON');
    expect((err.details as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
  });
});