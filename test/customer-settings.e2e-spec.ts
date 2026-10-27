import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuthBody, bearer, createTestApp, onboardCustomer, proBody, registerUser,
  seedProfessions, TestCtx,
} from './helpers';

const loc = (name: string, extra: object = {}) => ({
  name,
  latitude: 5.6,
  longitude: -0.19,
  ...extra,
});

describe('customer settings (e2e)', () => {
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

  const customer = async (locations: object[] = []) => {
    const user = await registerUser(ctx);
    await onboardCustomer(ctx, user, [professionIds[0]], locations);
    return user;
  };
  const api = (user: AuthBody) => ({
    list: () => ctx.api().get('/v1/me/locations').set(bearer(user.accessToken)),
    create: (body: object) => ctx.api().post('/v1/me/locations').set(bearer(user.accessToken)).send(body),
    update: (id: string, body: object) => ctx.api().patch(`/v1/me/locations/${id}`).set(bearer(user.accessToken)).send(body),
    remove: (id: string) => ctx.api().delete(`/v1/me/locations/${id}`).set(bearer(user.accessToken)),
    setPreferred: (body: object) => ctx.api().put('/v1/me/preferred-professions').set(bearer(user.accessToken)).send(body),
  });
  const defaults = (customerUserId: string) =>
    ctx.prisma.savedLocation.findMany({
      where: { customer: { userId: customerUserId }, isDefault: true },
    });

  it('requires a token', async () => {
    await ctx.api().get('/v1/me/locations').expect(401);
    await ctx.api().put('/v1/me/preferred-professions').send({}).expect(401);
  });

  it('rejects users without a finished customer profile', async () => {
    const plain = await registerUser(ctx);
    const res = await api(plain).list().expect(403);
    expect(res.body.code).toBe('ROLE_NOT_ONBOARDED');

    const pro = await registerUser(ctx);
    await ctx.api().post('/v1/me/professional-profile').set(bearer(pro.accessToken))
      .send(proBody(professionIds[0])).expect(201);
    await api(pro).create(loc('Home')).expect(403);
  });

  it('lists the default first, then oldest first', async () => {
    const user = await customer([loc('Home'), loc('Work')]);
    await api(user).create(loc('Gym')).expect(201);
    const res = await api(user).list().expect(200);
    expect(res.body.items.map((l: { name: string }) => l.name)).toEqual(['Home', 'Work', 'Gym']);
    expect(res.body.items[0].isDefault).toBe(true);
    expect(Object.keys(res.body.items[0]).sort()).toEqual(
      ['address', 'id', 'isDefault', 'latitude', 'longitude', 'name', 'searchRadiusKm'],
    );
  });

  it('makes the first location the default and keeps exactly one default', async () => {
    const user = await customer();
    const first = await api(user).create(loc('Home', { isDefault: false })).expect(201);
    expect(first.body.isDefault).toBe(true);
    expect(first.body.searchRadiusKm).toBe(2);

    const second = await api(user).create(loc('Work')).expect(201);
    expect(second.body.isDefault).toBe(false);

    const third = await api(user).create(loc('Gym', { isDefault: true })).expect(201);
    expect(third.body.isDefault).toBe(true);
    const rows = await defaults(user.user.id);
    expect(rows.map((r) => r.name)).toEqual(['Gym']);
  });

  it('validates location input with field paths', async () => {
    const user = await customer();
    const res = await api(user).create({ name: '', latitude: 91, longitude: 0, searchRadiusKm: 500 }).expect(400);
    expect(Object.keys(res.body.details)).toEqual(
      expect.arrayContaining(['name', 'latitude', 'searchRadiusKm']),
    );
  });

  it('stops at five locations', async () => {
    const user = await customer([1, 2, 3, 4, 5].map((n) => loc(`Place ${n}`)));
    const res = await api(user).create(loc('One too many')).expect(422);
    expect(res.body.code).toBe('LOCATION_LIMIT_REACHED');
    expect(await ctx.prisma.savedLocation.count()).toBe(5);
  });

  it('updates a location and moves the default', async () => {
    const user = await customer([loc('Home'), loc('Work')]);
    const items = (await api(user).list().expect(200)).body.items;
    const [home, work] = items;

    const renamed = await api(user).update(work.id, { name: 'Office', searchRadiusKm: 10, address: 'Ring Road' }).expect(200);
    expect(renamed.body).toMatchObject({ name: 'Office', searchRadiusKm: 10, address: 'Ring Road', isDefault: false });

    const moved = await api(user).update(work.id, { isDefault: true }).expect(200);
    expect(moved.body.isDefault).toBe(true);
    expect((await defaults(user.user.id)).map((r) => r.id)).toEqual([work.id]);
    expect(home.isDefault).toBe(true); // it was the default before the move
  });

  it('rejects bad updates, unknown ids and other customers locations', async () => {
    const user = await customer([loc('Home')]);
    const other = await customer([loc('Secret')]);
    const mine = (await api(user).list()).body.items[0];
    const theirs = (await api(other).list()).body.items[0];

    const off = await api(user).update(mine.id, { isDefault: false }).expect(400);
    expect(off.body.details).toHaveProperty('isDefault');

    await api(user).update('not-a-uuid', { name: 'X' }).expect(400);
    const missing = await api(user).update('00000000-0000-4000-8000-000000000000', { name: 'X' }).expect(404);
    expect(missing.body.code).toBe('NOT_FOUND');

    await api(user).update(theirs.id, { name: 'Hacked' }).expect(404);
    await api(user).remove(theirs.id).expect(404);
    const still = await ctx.prisma.savedLocation.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(still.name).toBe('Secret');
  });

  it('deletes a location and promotes the oldest when the default goes', async () => {
    const user = await customer([loc('Home'), loc('Work'), loc('Gym')]);
    const [home, work] = (await api(user).list()).body.items;

    await api(user).remove(home.id).expect(204);
    const after = (await api(user).list()).body.items;
    expect(after.map((l: { name: string }) => l.name)).toEqual(['Work', 'Gym']);
    expect(after[0].id).toBe(work.id);
    expect(after[0].isDefault).toBe(true);
    expect(await defaults(user.user.id)).toHaveLength(1);

    for (const l of after) await api(user).remove(l.id).expect(204);
    expect((await api(user).list()).body.items).toEqual([]);
  });

  it('replaces preferred professions', async () => {
    const user = await customer();
    const res = await api(user).setPreferred({ professionIds: [professionIds[1], professionIds[2]] }).expect(200);
    expect(res.body.items.map((p: { name: string }) => p.name)).toEqual(['Cleaner', 'Electrician']);

    const stored = await ctx.prisma.customerPreferredProfession.findMany({
      where: { customer: { userId: user.user.id } },
    });
    expect(stored.map((s) => s.professionId).sort()).toEqual([professionIds[1], professionIds[2]].sort());
  });

  it('validates preferred professions and leaves the old set on failure', async () => {
    const user = await customer();
    expect(Object.keys((await api(user).setPreferred({ professionIds: [] }).expect(400)).body.details))
      .toContain('professionIds');
    await api(user).setPreferred({ professionIds: [professionIds[0], professionIds[0]] }).expect(400);
    const unknown = await api(user).setPreferred({
      professionIds: ['00000000-0000-4000-8000-000000000000'],
    }).expect(400);
    expect(unknown.body.details.professionIds).toBeDefined();

    const stored = await ctx.prisma.customerPreferredProfession.findMany({
      where: { customer: { userId: user.user.id } },
    });
    expect(stored.map((s) => s.professionId)).toEqual([professionIds[0]]);
  });
});