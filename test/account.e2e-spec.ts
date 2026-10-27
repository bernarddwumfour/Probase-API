import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createTestApp, registerUser, TestCtx } from './helpers';

describe('passwords and account (e2e)', () => {
  let ctx: TestCtx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  describe('forgot and reset password', () => {
    it('forgot-password responds identically for known and unknown emails', async () => {
      const user = await registerUser(ctx);
      const known = await ctx.api().post('/v1/auth/forgot-password').send({ email: user.email }).expect(200);
      const ghost = await ctx.api().post('/v1/auth/forgot-password').send({ email: 'ghost@example.com' }).expect(200);
      expect(known.body).toEqual(ghost.body);
      expect(ctx.mail.reset.has(user.email)).toBe(true);
      expect(ctx.mail.reset.has('ghost@example.com')).toBe(false);
    });

    it('answers wrong codes and unknown emails with the same RESET_CODE_INVALID', async () => {
      const user = await registerUser(ctx);
      await ctx.api().post('/v1/auth/forgot-password').send({ email: user.email });
      const body = { code: '000000', newPassword: 'newpassword123' };
      const wrong = await ctx.api().post('/v1/auth/reset-password').send({ email: user.email, ...body }).expect(400);
      const ghost = await ctx.api().post('/v1/auth/reset-password').send({ email: 'ghost@example.com', ...body }).expect(400);
      expect(wrong.body.code).toBe('RESET_CODE_INVALID');
      expect(ghost.body).toEqual(wrong.body);
    });

    it('resets the password, revokes every session and burns the code', async () => {
      const user = await registerUser(ctx);
      await ctx.api().post('/v1/auth/forgot-password').send({ email: user.email });
      const code = ctx.mail.reset.get(user.email)!;

      await ctx.api().post('/v1/auth/reset-password').send({ email: user.email, code, newPassword: 'newpassword123' }).expect(204);

      await ctx.api().post('/v1/auth/login').send({ email: user.email, password: user.password }).expect(401);
      await ctx.api().post('/v1/auth/login').send({ email: user.email, password: 'newpassword123' }).expect(200);
      await ctx.api().post('/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);

      const reuse = await ctx.api().post('/v1/auth/reset-password').send({ email: user.email, code, newPassword: 'another12345' }).expect(400);
      expect(reuse.body.code).toBe('RESET_CODE_INVALID');
    });

    it('marks an unverified email as verified after a successful reset', async () => {
      const email = 'late@example.com';
      await ctx.api().post('/v1/auth/signup').send({ fullName: 'Late Verifier', email, password: 'password123' });
      await ctx.api().post('/v1/auth/forgot-password').send({ email });
      const code = ctx.mail.reset.get(email)!;
      await ctx.api().post('/v1/auth/reset-password').send({ email, code, newPassword: 'newpassword123' }).expect(204);

      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.emailVerifiedAt).not.toBeNull();
    });
  });

  describe('change password', () => {
    it('requires a token', async () => {
      const res = await ctx.api().post('/v1/auth/change-password').send({ oldPassword: 'a', newPassword: 'b'.repeat(8) }).expect(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('checks the old password and refuses an unchanged one', async () => {
      const user = await registerUser(ctx);
      const wrong = await ctx.api().post('/v1/auth/change-password').set(bearer(user.accessToken))
        .send({ oldPassword: 'wrongpass1', newPassword: 'another12345' }).expect(400);
      expect(wrong.body.code).toBe('OLD_PASSWORD_INCORRECT');

      const same = await ctx.api().post('/v1/auth/change-password').set(bearer(user.accessToken))
        .send({ oldPassword: user.password, newPassword: user.password }).expect(400);
      expect(same.body.code).toBe('PASSWORD_UNCHANGED');
    });

    it('signs out other devices but returns a fresh session for this one', async () => {
      const user = await registerUser(ctx);
      const otherDevice = (await ctx.api().post('/v1/auth/login').send({ email: user.email, password: user.password }).expect(200)).body;

      const res = await ctx.api().post('/v1/auth/change-password').set(bearer(user.accessToken))
        .send({ oldPassword: user.password, newPassword: 'another12345' }).expect(200);
      expect(res.body.accessToken).toBeTruthy();

      await ctx.api().post('/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);
      await ctx.api().post('/v1/auth/refresh').send({ refreshToken: otherDevice.refreshToken }).expect(401);
      await ctx.api().post('/v1/auth/refresh').send({ refreshToken: res.body.refreshToken }).expect(200);
      await ctx.api().post('/v1/auth/login').send({ email: user.email, password: 'another12345' }).expect(200);
    });
  });

  describe('profile', () => {
    it('GET /me requires a token and returns the account summary', async () => {
      await ctx.api().get('/v1/me').expect(401);
      const user = await registerUser(ctx);
      const res = await ctx.api().get('/v1/me').set(bearer(user.accessToken)).expect(200);
      expect(res.body.user.email).toBe(user.email);
      expect(res.body.activeRole).toBeNull();
      expect(res.body.onboarded).toEqual({ customer: false, professional: false });
    });

    it('PATCH /me normalises the phone, rejects bad input, and clears with null', async () => {
      const user = await registerUser(ctx);
      const ok = await ctx.api().patch('/v1/me').set(bearer(user.accessToken))
        .send({ fullName: 'Kofi A. Mensah', phone: '+233 24 123 4567' }).expect(200);
      expect(ok.body.user.phone).toBe('+233241234567');
      expect(ok.body.user.fullName).toBe('Kofi A. Mensah');

      const bad = await ctx.api().patch('/v1/me').set(bearer(user.accessToken))
        .send({ phone: '0241234567', avatarUrl: 'http://x' }).expect(400);
      expect(Object.keys(bad.body.details)).toEqual(expect.arrayContaining(['phone', 'avatarUrl']));

      const cleared = await ctx.api().patch('/v1/me').set(bearer(user.accessToken)).send({ phone: null }).expect(200);
      expect(cleared.body.user.phone).toBeNull();
    });
  });

  describe('role switching', () => {
    it('rejects a role that is not onboarded and an invalid role', async () => {
      const user = await registerUser(ctx);
      const res = await ctx.api().put('/v1/me/active-role').set(bearer(user.accessToken)).send({ role: 'professional' }).expect(422);
      expect(res.body.code).toBe('ROLE_NOT_ONBOARDED');
      await ctx.api().put('/v1/me/active-role').set(bearer(user.accessToken)).send({ role: 'admin' }).expect(400);
    });

    it('switches to an onboarded role and remembers it on the next login', async () => {
      const user = await registerUser(ctx);
      await ctx.prisma.customerProfile.create({ data: { userId: user.user.id, onboardedAt: new Date() } });

      const res = await ctx.api().put('/v1/me/active-role').set(bearer(user.accessToken)).send({ role: 'customer' }).expect(200);
      expect(res.body.activeRole).toBe('customer');
      expect(res.body.onboarded.customer).toBe(true);

      await ctx.api().put('/v1/me/active-role').set(bearer(user.accessToken)).send({ role: 'professional' }).expect(422);

      const login = await ctx.api().post('/v1/auth/login').send({ email: user.email, password: user.password }).expect(200);
      expect(login.body.activeRole).toBe('customer');
    });

    it('does not treat a started but unfinished profile as onboarded', async () => {
      const user = await registerUser(ctx);
      await ctx.prisma.customerProfile.create({ data: { userId: user.user.id } });
      const res = await ctx.api().put('/v1/me/active-role').set(bearer(user.accessToken)).send({ role: 'customer' }).expect(422);
      expect(res.body.code).toBe('ROLE_NOT_ONBOARDED');
    });
  });

  describe('guard checks the database on every request', () => {
    it('rejects a suspended user with a token that was valid a moment ago', async () => {
      const user = await registerUser(ctx);
      await ctx.api().get('/v1/me').set(bearer(user.accessToken)).expect(200);
      await ctx.prisma.user.update({ where: { id: user.user.id }, data: { status: 'suspended' } });
      const res = await ctx.api().get('/v1/me').set(bearer(user.accessToken)).expect(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
    });
  });

  describe('account deletion', () => {
    it('requires the current password', async () => {
      const user = await registerUser(ctx);
      const none = await ctx.api().delete('/v1/me').set(bearer(user.accessToken)).send({}).expect(400);
      expect(none.body.code).toBe('PASSWORD_INCORRECT');
      const wrong = await ctx.api().delete('/v1/me').set(bearer(user.accessToken)).send({ password: 'wrongpass1' }).expect(400);
      expect(wrong.body.code).toBe('PASSWORD_INCORRECT');
    });

    it('anonymises the account, ends every session, and frees the email', async () => {
      const user = await registerUser(ctx, { fullName: 'Kofi Mensah' });
      await ctx.api().delete('/v1/me').set(bearer(user.accessToken)).send({ password: user.password }).expect(204);

      await ctx.api().get('/v1/me').set(bearer(user.accessToken)).expect(401);
      const login = await ctx.api().post('/v1/auth/login').send({ email: user.email, password: user.password }).expect(401);
      expect(login.body.code).toBe('INVALID_CREDENTIALS');
      await ctx.api().post('/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);

      const row = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.user.id } });
      expect(row.email).toBe(`deleted+${user.user.id}@deleted.invalid`);
      expect(row.fullName).toBe('Deleted user');
      expect(row.passwordHash).toBeNull();
      expect(row.deletedAt).not.toBeNull();
      expect(await ctx.prisma.refreshSession.count({ where: { userId: user.user.id } })).toBe(0);

      // The same email can sign up again as a brand new user
      await ctx.api().post('/v1/auth/signup').send({ fullName: 'Kofi Again', email: user.email, password: 'password123' }).expect(201);
      expect(await ctx.prisma.user.count()).toBe(2);
    });
  });
});