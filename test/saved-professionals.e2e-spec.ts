import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AuthBody, bearer, createCustomer, createProfessional, createTestApp, onboardCustomer,
  registerUser, seedProfessions, TestCtx,
} from './helpers';

describe('saved professionals (e2e)', () => {
  let ctx: TestCtx;
  let customer: AuthBody;
  let other: AuthBody;
  let plumberId: string;
  const pros: Record<string, { user: AuthBody; profileId: string }> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.reset();
    const [plumber, electrician] = await seedProfessions(ctx);
    plumberId = plumber.id;
    pros.a = await createProfessional(ctx, plumber.id, { businessName: 'Alpha Plumbing', latitude: 5.6037, longitude: -0.187 });
    pros.b = await createProfessional(ctx, electrician.id, { businessName: 'Bravo Electric', latitude: 5.65, longitude: -0.187 });
    pros.c = await createProfessional(ctx, plumber.id, { businessName: 'Charlie Pipes', latitude: 6.0, longitude: -0.187 });
    customer = await createCustomer(ctx, [plumber.id]);
    other = await createCustomer(ctx, [plumber.id]);
  });
  afterEach(() => ctx.prisma.savedProfessional.deleteMany());
  afterAll(async () => {
    await ctx.app.close();
  });

  const list = (user: AuthBody, qs = '') =>
    ctx.api().get(`/v1/me/saved-professionals${qs}`).set(bearer(user.accessToken));
  const save = (user: AuthBody, id: string) =>
    ctx.api().put(`/v1/me/saved-professionals/${id}`).set(bearer(user.accessToken));
  const unsave = (user: AuthBody, id: string) =>
    ctx.api().delete(`/v1/me/saved-professionals/${id}`).set(bearer(user.accessToken));
  const names = (res: { body: { items: { name: string }[] } }) => res.body.items.map((i) => i.name);

  it('requires a token and a finished customer profile', async () => {
    await ctx.api().get('/v1/me/saved-professionals').expect(401);
    const plain = await registerUser(ctx);
    expect((await list(plain).expect(403)).body.code).toBe('ROLE_NOT_ONBOARDED');
    await save(plain, pros.a.profileId).expect(403);
  });

  it('saves idempotently, lists the card with isSaved, and flags it in search and profile', async () => {
    await save(customer, pros.a.profileId).expect(204);
    await save(customer, pros.a.profileId).expect(204);

    const res = await list(customer).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ id: pros.a.profileId, name: 'Alpha Plumbing', isSaved: true });
    expect(await ctx.prisma.savedProfessional.count()).toBe(1);

    const search = await ctx.api().get('/v1/professionals').set(bearer(customer.accessToken)).expect(200);
    const flags = Object.fromEntries(
      search.body.items.map((i: { name: string; isSaved: boolean }) => [i.name, i.isSaved]),
    );
    expect(flags).toEqual({ 'Alpha Plumbing': true, 'Bravo Electric': false, 'Charlie Pipes': false });

    const profile = await ctx.api().get(`/v1/professionals/${pros.a.profileId}`).set(bearer(customer.accessToken)).expect(200);
    expect(profile.body.isSaved).toBe(true);
  });

  it('rejects unknown ids, bad ids and the user’s own profile', async () => {
    const missing = await save(customer, '00000000-0000-4000-8000-000000000000').expect(404);
    expect(missing.body.code).toBe('NOT_FOUND');
    await save(customer, 'not-a-uuid').expect(400);

    await onboardCustomer(ctx, pros.c.user, [plumberId]); // c now holds both roles
    await save(pros.c.user, pros.c.profileId).expect(404);
    expect(await ctx.prisma.savedProfessional.count()).toBe(0);
  });

  it('lists the newest first and pages with hasMore', async () => {
    await save(customer, pros.a.profileId).expect(204);
    await save(customer, pros.b.profileId).expect(204);
    await save(customer, pros.c.profileId).expect(204);

    expect(names(await list(customer).expect(200))).toEqual([
      'Charlie Pipes', 'Bravo Electric', 'Alpha Plumbing',
    ]);
    const p1 = await list(customer, '?limit=2&page=1').expect(200);
    const p2 = await list(customer, '?limit=2&page=2').expect(200);
    expect(names(p1)).toEqual(['Charlie Pipes', 'Bravo Electric']);
    expect(p1.body.hasMore).toBe(true);
    expect(names(p2)).toEqual(['Alpha Plumbing']);
    expect(p2.body.hasMore).toBe(false);
  });

  it('removes idempotently', async () => {
    await save(customer, pros.a.profileId).expect(204);
    await unsave(customer, pros.a.profileId).expect(204);
    await unsave(customer, pros.a.profileId).expect(204);
    await unsave(customer, '00000000-0000-4000-8000-000000000000').expect(204);
    expect((await list(customer).expect(200)).body.items).toEqual([]);
  });

  it('hides saved professionals that are no longer visible', async () => {
    await save(customer, pros.a.profileId).expect(204);
    await save(customer, pros.b.profileId).expect(204);
    try {
      await ctx.prisma.user.update({ where: { id: pros.b.user.user.id }, data: { status: 'suspended' } });
      expect(names(await list(customer).expect(200))).toEqual(['Alpha Plumbing']);
    } finally {
      await ctx.prisma.user.update({ where: { id: pros.b.user.user.id }, data: { status: 'active' } });
    }
    expect(names(await list(customer).expect(200))).toEqual(['Bravo Electric', 'Alpha Plumbing']);
  });

  it('keeps each customer’s list separate', async () => {
    await save(customer, pros.a.profileId).expect(204);
    await save(other, pros.b.profileId).expect(204);
    expect(names(await list(customer).expect(200))).toEqual(['Alpha Plumbing']);
    expect(names(await list(other).expect(200))).toEqual(['Bravo Electric']);
    await unsave(other, pros.a.profileId).expect(204); // not theirs to remove
    expect(names(await list(customer).expect(200))).toEqual(['Alpha Plumbing']);
  });

  it('adds distance when a location is sent', async () => {
    await save(customer, pros.b.profileId).expect(204);
    const res = await list(customer, '?lat=5.6037&lng=-0.187').expect(200);
    expect(res.body.items[0].distanceKm).toBeGreaterThan(5);
    expect(res.body.items[0].distanceKm).toBeLessThan(5.3);
    const noGeo = await list(customer).expect(200);
    expect(noGeo.body.items[0].distanceKm).toBeNull();
    await list(customer, '?lat=5.6').expect(400);
  });
});