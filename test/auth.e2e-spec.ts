import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, registerUser, TestCtx } from './helpers';

describe('auth flow (e2e)', () => {
  let ctx: TestCtx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  describe('signup', () => {
    it('returns field errors in the standard shape and rejects unknown fields', async () => {
      const res = await ctx
        .api()
        .post('/v1/auth/signup')
        .send({ fullName: 'A', email: 'nope', password: '123', role: 'admin' })
        .expect(400);
      expect(res.body.statusCode).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(Object.keys(res.body.details)).toEqual(
        expect.arrayContaining(['fullName', 'email', 'password', 'role']),
      );
    });

    it('trims and lowercases the email and sends a code', async () => {
      const res = await ctx
        .api()
        .post('/v1/auth/signup')
        .send({ fullName: 'Kofi Mensah', email: '  Kofi@Example.com ', password: 'password123' })
        .expect(201);
      expect(res.body).toEqual({ email: 'kofi@example.com', verificationRequired: true });
      expect(ctx.mail.verification.get('kofi@example.com')).toMatch(/^\d{6}$/);
      expect(await ctx.prisma.user.count()).toBe(1);
    });

    it('returns 409 EMAIL_TAKEN for a verified email, in any letter case', async () => {
      await registerUser(ctx, { email: 'taken@example.com' });
      const res = await ctx
        .api()
        .post('/v1/auth/signup')
        .send({ fullName: 'Someone Else', email: 'TAKEN@example.com', password: 'password123' })
        .expect(409);
      expect(res.body.code).toBe('EMAIL_TAKEN');
    });

    it('does not let a second signup overwrite an unverified account', async () => {
      const email = 'victim@example.com';
      await ctx.api().post('/v1/auth/signup').send({ fullName: 'Victim', email, password: 'victimpass1' });
      await ctx.api().post('/v1/auth/signup').send({ fullName: 'Attacker', email, password: 'attackerpass1' });

      const code = ctx.mail.verification.get(email)!;
      await ctx.api().post('/v1/auth/verify-otp').send({ email, code }).expect(200);

      await ctx.api().post('/v1/auth/login').send({ email, password: 'attackerpass1' }).expect(401);
      await ctx.api().post('/v1/auth/login').send({ email, password: 'victimpass1' }).expect(200);
    });
  });

  describe('verify-otp and resend-otp', () => {
    it('rejects a wrong code, then locks after 5 attempts', async () => {
      const email = 'lock@example.com';
      await ctx.api().post('/v1/auth/signup').send({ fullName: 'Lock Test', email, password: 'password123' });
      const real = ctx.mail.verification.get(email)!;
      const wrong = real === '000000' ? '111111' : '000000';

      for (let i = 0; i < 5; i++) {
        const res = await ctx.api().post('/v1/auth/verify-otp').send({ email, code: wrong }).expect(400);
        expect(res.body.code).toBe('OTP_INVALID');
      }
      const locked = await ctx.api().post('/v1/auth/verify-otp').send({ email, code: real }).expect(429);
      expect(locked.body.code).toBe('OTP_ATTEMPTS_EXCEEDED');
    });

    it('returns tokens and onboarding state on success', async () => {
      const auth = await registerUser(ctx);
      expect(auth.accessToken).toBeTruthy();
      expect(auth.refreshToken).toBeTruthy();
      expect(auth.activeRole).toBeNull();
      expect(auth.onboarded).toEqual({ customer: false, professional: false });
      expect(await ctx.prisma.refreshSession.count({ where: { userId: auth.user.id } })).toBe(1);
    });

    it('answers unknown emails exactly like wrong codes', async () => {
      const res = await ctx
        .api()
        .post('/v1/auth/verify-otp')
        .send({ email: 'ghost@example.com', code: '123456' })
        .expect(400);
      expect(res.body.code).toBe('OTP_INVALID');
    });

    it('resend-otp gives the same response whether or not the account exists', async () => {
      await ctx.api().post('/v1/auth/signup').send({ fullName: 'Real User', email: 'real@example.com', password: 'password123' });
      const real = await ctx.api().post('/v1/auth/resend-otp').send({ email: 'real@example.com' }).expect(200);
      const ghost = await ctx.api().post('/v1/auth/resend-otp').send({ email: 'ghost@example.com' }).expect(200);
      expect(real.body).toEqual(ghost.body);
    });
  });

  describe('login', () => {
    it('gives the same 401 for a wrong password and an unknown email', async () => {
      const user = await registerUser(ctx);
      const wrong = await ctx.api().post('/v1/auth/login').send({ email: user.email, password: 'wrongpass1' }).expect(401);
      const ghost = await ctx.api().post('/v1/auth/login').send({ email: 'ghost@example.com', password: 'wrongpass1' }).expect(401);
      expect(wrong.body).toEqual(ghost.body);
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('returns 403 EMAIL_NOT_VERIFIED and sends a fresh code', async () => {
      const email = 'unverified@example.com';
      await ctx.api().post('/v1/auth/signup').send({ fullName: 'Un Verified', email, password: 'password123' });
      ctx.mail.verification.clear();

      const res = await ctx.api().post('/v1/auth/login').send({ email, password: 'password123' }).expect(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
      expect(ctx.mail.verification.get(email)).toMatch(/^\d{6}$/);
    });

    it('does not reveal unverified status to someone with the wrong password', async () => {
      const email = 'quiet@example.com';
      await ctx.api().post('/v1/auth/signup').send({ fullName: 'Quiet User', email, password: 'password123' });
      const res = await ctx.api().post('/v1/auth/login').send({ email, password: 'wrongpass1' }).expect(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('logs in a verified user', async () => {
      const user = await registerUser(ctx);
      const res = await ctx.api().post('/v1/auth/login').send({ email: user.email, password: user.password }).expect(200);
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.user.email).toBe(user.email);
    });

    it('rejects a suspended account', async () => {
      const user = await registerUser(ctx);
      await ctx.prisma.user.update({ where: { id: user.user.id }, data: { status: 'suspended' } });
      const res = await ctx.api().post('/v1/auth/login').send({ email: user.email, password: user.password }).expect(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
    });
  });

  describe('refresh and logout', () => {
    it('rotates the refresh token', async () => {
      const user = await registerUser(ctx);
      const res = await ctx.api().post('/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(200);
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
      expect(res.body.refreshToken).not.toBe(user.refreshToken);
    });

    it('revokes the whole family when an old token is replayed', async () => {
      const user = await registerUser(ctx);
      const rt1 = user.refreshToken;
      const rt2 = (await ctx.api().post('/v1/auth/refresh').send({ refreshToken: rt1 }).expect(200)).body.refreshToken;

      const replay = await ctx.api().post('/v1/auth/refresh').send({ refreshToken: rt1 }).expect(401);
      expect(replay.body.code).toBe('REFRESH_REUSED');

      const child = await ctx.api().post('/v1/auth/refresh').send({ refreshToken: rt2 }).expect(401);
      expect(child.body.code).toBe('REFRESH_INVALID');
    });

    it('lets only one of two simultaneous refreshes win', async () => {
      const user = await registerUser(ctx);
      const results = await Promise.all([
        ctx.api().post('/v1/auth/refresh').send({ refreshToken: user.refreshToken }),
        ctx.api().post('/v1/auth/refresh').send({ refreshToken: user.refreshToken }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    });

    it('rejects a garbage refresh token', async () => {
      const res = await ctx.api().post('/v1/auth/refresh').send({ refreshToken: 'x'.repeat(60) }).expect(401);
      expect(res.body.code).toBe('REFRESH_INVALID');
    });

    it('rejects an expired refresh token', async () => {
      const user = await registerUser(ctx);
      await ctx.prisma.refreshSession.updateMany({
        where: { userId: user.user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await ctx.api().post('/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);
      expect(res.body.code).toBe('REFRESH_INVALID');
    });

    it('logout returns 204 and kills the session; unknown tokens also return 204', async () => {
      const user = await registerUser(ctx);
      await ctx.api().post('/v1/auth/logout').send({ refreshToken: user.refreshToken }).expect(204);
      await ctx.api().post('/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);
      await ctx.api().post('/v1/auth/logout').send({ refreshToken: 'x'.repeat(60) }).expect(204);
    });
  });
});