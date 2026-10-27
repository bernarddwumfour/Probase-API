import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createTestApp, registerUser, seedProfessions, TestCtx } from './helpers';

describe('professions and customer onboarding (e2e)', () => {
  let ctx: TestCtx;
  let professionIds: string[];

  beforeAll(async () => {
    ctx = await createTestApp();
    professionIds = (await seedProfessions(ctx)).map((p) => p.id);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  describe('GET /professions', () => {
    it('requires a token', async () => {
      await ctx.api().get('/v1/professions').expect(401);
    });

    it('lists active professions alphabetically and hides inactive ones', async () => {
      const user = await registerUser(ctx);
      await ctx.prisma.profession.update({
        where: { slug: 'cleaner' },
        data: { active: false },
      });
      const res = await ctx.api().get('/v1/professions').set(bearer(user.accessToken)).expect(200);
      expect(res.body.items.map((p: { name: string }) => p.name)).toEqual(['Electrician', 'Plumber']);
      expect(Object.keys(res.body.items[0]).sort()).toEqual(['iconUrl', 'id', 'name', 'slug']);
      await ctx.prisma.profession.update({ where: { slug: 'cleaner' }, data: { active: true } });
    });
  });

  describe('POST /me/customer-profile', () => {
    const location = { name: 'Home', latitude: 5.6037, longitude: -0.187, searchRadiusKm: 5 };

    it('requires a token', async () => {
      await ctx.api().post('/v1/me/customer-profile').send({}).expect(401);
    });

    it('rejects empty, malformed and unknown professions', async () => {
      const user = await registerUser(ctx);
      const post = (body: object) =>
        ctx.api().post('/v1/me/customer-profile').set(bearer(user.accessToken)).send(body);

      const empty = await post({ preferredProfessionIds: [] }).expect(400);
      expect(empty.body.details).toHaveProperty('preferredProfessionIds');

      await post({ preferredProfessionIds: ['not-a-uuid'] }).expect(400);
      await post({ preferredProfessionIds: [professionIds[0], professionIds[0]] }).expect(400);

      const unknown = await post({
        preferredProfessionIds: ['00000000-0000-4000-8000-000000000000'],
      }).expect(400);
      expect(unknown.body.code).toBe('VALIDATION_FAILED');
      expect(unknown.body.details.preferredProfessionIds).toBeDefined();
    });

    it('rejects an inactive profession', async () => {
      const user = await registerUser(ctx);
      await ctx.prisma.profession.update({ where: { slug: 'plumber' }, data: { active: false } });
      await ctx.api().post('/v1/me/customer-profile').set(bearer(user.accessToken))
        .send({ preferredProfessionIds: [professionIds[0]] }).expect(400);
      await ctx.prisma.profession.update({ where: { slug: 'plumber' }, data: { active: true } });
    });

    it('rejects bad coordinates, radius and too many locations, with nested field paths', async () => {
      const user = await registerUser(ctx);
      const res = await ctx.api().post('/v1/me/customer-profile').set(bearer(user.accessToken))
        .send({
          preferredProfessionIds: [professionIds[0]],
          locations: [{ name: 'X', latitude: 91, longitude: 0, searchRadiusKm: 500 }],
        }).expect(400);
      expect(Object.keys(res.body.details)).toEqual(
        expect.arrayContaining(['locations.0.latitude', 'locations.0.searchRadiusKm']),
      );

      await ctx.api().post('/v1/me/customer-profile').set(bearer(user.accessToken))
        .send({ preferredProfessionIds: [professionIds[0]], locations: Array(6).fill(location) })
        .expect(400);
    });

    it('creates the profile, preferences and locations, and activates the role', async () => {
      const user = await registerUser(ctx);
      const res = await ctx.api().post('/v1/me/customer-profile').set(bearer(user.accessToken))
        .send({
          preferredProfessionIds: [professionIds[0], professionIds[1]],
          locations: [location, { name: 'Work', latitude: 5.55, longitude: -0.2 }],
        }).expect(201);

      expect(res.body.activeRole).toBe('customer');
      expect(res.body.onboarded).toEqual({ customer: true, professional: false });

      const profile = await ctx.prisma.customerProfile.findUniqueOrThrow({
        where: { userId: user.user.id },
        include: { savedLocations: { orderBy: { name: 'desc' } }, preferredProfessions: true },
      });
      expect(profile.onboardedAt).not.toBeNull();
      expect(profile.preferredProfessions).toHaveLength(2);
      expect(profile.savedLocations).toHaveLength(2);
      const home = profile.savedLocations.find((l) => l.name === 'Home')!;
      const work = profile.savedLocations.find((l) => l.name === 'Work')!;
      expect(home.isDefault).toBe(true);
      expect(home.searchRadiusKm).toBe(5);
      expect(work.isDefault).toBe(false);
      expect(work.searchRadiusKm).toBe(2);

      const me = await ctx.api().get('/v1/me').set(bearer(user.accessToken)).expect(200);
      expect(me.body.activeRole).toBe('customer');
      expect(me.body.onboarded.customer).toBe(true);

      await ctx.api().put('/v1/me/active-role').set(bearer(user.accessToken))
        .send({ role: 'professional' }).expect(422);
    });

    it('works without locations', async () => {
      const user = await registerUser(ctx);
      await ctx.api().post('/v1/me/customer-profile').set(bearer(user.accessToken))
        .send({ preferredProfessionIds: [professionIds[0]] }).expect(201);
      expect(await ctx.prisma.savedLocation.count()).toBe(0);
    });

    it('completes a leftover unfinished profile instead of failing', async () => {
      const user = await registerUser(ctx);
      await ctx.prisma.customerProfile.create({ data: { userId: user.user.id } });
      await ctx.api().post('/v1/me/customer-profile').set(bearer(user.accessToken))
        .send({ preferredProfessionIds: [professionIds[0]] }).expect(201);
      expect(await ctx.prisma.customerProfile.count({ where: { userId: user.user.id } })).toBe(1);
    });

    it('returns 409 ALREADY_ONBOARDED the second time and changes nothing', async () => {
      const user = await registerUser(ctx);
      const body = { preferredProfessionIds: [professionIds[0]], locations: [location] };
      await ctx.api().post('/v1/me/customer-profile').set(bearer(user.accessToken)).send(body).expect(201);
      const again = await ctx.api().post('/v1/me/customer-profile').set(bearer(user.accessToken)).send(body).expect(409);
      expect(again.body.code).toBe('ALREADY_ONBOARDED');
      expect(await ctx.prisma.savedLocation.count()).toBe(1);
    });

    it('lets only one of two simultaneous submissions win', async () => {
      const user = await registerUser(ctx);
      const send = () =>
        ctx.api().post('/v1/me/customer-profile').set(bearer(user.accessToken))
          .send({ preferredProfessionIds: [professionIds[0]], locations: [location] });
      const results = await Promise.all([send(), send()]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await ctx.prisma.savedLocation.count()).toBe(1);
    });
  });
});