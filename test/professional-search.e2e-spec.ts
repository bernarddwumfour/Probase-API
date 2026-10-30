import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { haversineKm } from '../src/common/geo';
import {
  AuthBody, bearer, createCustomer, createProfessional, createTestApp, onboardCustomer,
  registerUser, seedProfessions, TestCtx,
} from './helpers';

const HERE = { lat: 5.6037, lng: -0.187 };
const GEO = `lat=${HERE.lat}&lng=${HERE.lng}`;

describe('professional search and profiles (e2e)', () => {
  let ctx: TestCtx;
  let customer: AuthBody;
  let plumberId: string;
  const pros: Record<string, { user: AuthBody; profileId: string; lat: number; lng: number }> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.reset();
    const [plumber, electrician, cleaner] = await seedProfessions(ctx);
    plumberId = plumber.id;

    const make = async (
      key: string,
      professionId: string,
      businessName: string,
      lat: number,
      lng: number,
      services?: object[],
    ) => {
      const p = await createProfessional(ctx, professionId, {
        businessName,
        latitude: lat,
        longitude: lng,
        services,
      });
      pros[key] = { ...p, lat, lng };
    };

    // Distances from HERE: kofi 0.1 km, yaw 1.6 km, ama 5.1 km, sparkle 10.7 km, far 43.9 km
    await make('kofi', plumber.id, 'Kofi Plumbing', 5.605, -0.187, [
      { name: 'Pipe Replacement', description: 'Any pipe', rate: 120, unit: 'job' },
      { name: 'Call-out', rate: 12.5, unit: 'hr' },
    ]);
    await make('ama', plumber.id, 'Ama Pipes', 5.65, -0.187);
    await make('far', plumber.id, 'Far Fix', 6.0, -0.187);
    await make('yaw', electrician.id, 'Yaw Electric', 5.61, -0.2);
    await make('sparkle', cleaner.id, 'Sparkle Cleaners', 5.7, -0.187);

    const rate = (key: string, avg: number, count: number) =>
      ctx.prisma.professionalProfile.update({
        where: { id: pros[key].profileId },
        data: { ratingAverage: avg, ratingCount: count },
      });
    await rate('kofi', 4.5, 30);
    await rate('ama', 4.8, 12);
    await rate('far', 3, 5);
    await rate('sparkle', 4.8, 20);
    await ctx.prisma.professionalProfile.update({
      where: { id: pros.ama.profileId },
      data: { verificationStatus: 'approved' },
    });

    customer = await createCustomer(ctx, [plumber.id]);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const get = (user: AuthBody, path: string) =>
    ctx.api().get(path).set(bearer(user.accessToken));
  const search = (qs = '', user = customer) => get(user, `/v1/professionals${qs}`);
  const names = (res: { body: { items: { name: string }[] } }) => res.body.items.map((i) => i.name);

  it('requires a token and a finished customer profile', async () => {
    await ctx.api().get('/v1/professionals').expect(401);
    const plain = await registerUser(ctx);
    const res = await search('', plain).expect(403);
    expect(res.body.code).toBe('ROLE_NOT_ONBOARDED');
    await search('', pros.kofi.user).expect(403); // professional only
  });

  it('sorts by rating, then rating count, when no location is sent', async () => {
    const res = await search().expect(200);
    expect(names(res)).toEqual([
      'Sparkle Cleaners', 'Ama Pipes', 'Kofi Plumbing', 'Far Fix', 'Yaw Electric',
    ]);
    expect(res.body).toMatchObject({ page: 1, limit: 20, hasMore: false });
    for (const item of res.body.items) {
      expect(item.distanceKm).toBeNull();
      expect(item.inServiceArea).toBeNull();
    }
  });

  it('sorts by distance when a location is sent, with exact distances', async () => {
    const res = await search(`?${GEO}`).expect(200);
    expect(names(res)).toEqual([
      'Kofi Plumbing', 'Yaw Electric', 'Ama Pipes', 'Sparkle Cleaners', 'Far Fix',
    ]);
    for (const item of res.body.items) {
      const p = Object.values(pros).find((x) => x.profileId === item.id)!;
      expect(item.distanceKm).toBeCloseTo(haversineKm(HERE.lat, HERE.lng, p.lat, p.lng), 1);
      expect(item.inServiceArea).toBe(item.distanceKm <= item.operationalRadiusKm);
    }
  });

  it('filters by radius', async () => {
    expect(names(await search(`?${GEO}&radiusKm=2`).expect(200))).toEqual([
      'Kofi Plumbing', 'Yaw Electric',
    ]);
    expect(names(await search(`?${GEO}&radiusKm=6`).expect(200))).toEqual([
      'Kofi Plumbing', 'Yaw Electric', 'Ama Pipes',
    ]);
  });

  it('can sort by rating while still reporting distance', async () => {
    const res = await search(`?${GEO}&sort=rating`).expect(200);
    expect(names(res)).toEqual([
      'Sparkle Cleaners', 'Ama Pipes', 'Kofi Plumbing', 'Far Fix', 'Yaw Electric',
    ]);
    expect(res.body.items.every((i: { distanceKm: number | null }) => i.distanceKm !== null)).toBe(true);
  });

  it('filters by profession', async () => {
    const res = await search(`?${GEO}&professionId=${plumberId}`).expect(200);
    expect(names(res)).toEqual(['Kofi Plumbing', 'Ama Pipes', 'Far Fix']);
  });

  it('searches names, professions and services, ignoring case and wildcards', async () => {
    expect(names(await search('?q=pipe').expect(200))).toEqual(['Ama Pipes', 'Kofi Plumbing']);
    expect(names(await search('?q=plumber').expect(200))).toEqual([
      'Ama Pipes', 'Kofi Plumbing', 'Far Fix',
    ]);
    expect(names(await search('?q=%20SPARKLE%20').expect(200))).toEqual(['Sparkle Cleaners']);
    expect(names(await search('?q=kofi%20plumbing%20owner').expect(200))).toEqual(['Kofi Plumbing']);
    expect((await search('?q=%25').expect(200)).body.items).toEqual([]);
  });

  it('limits results to verified professionals when asked', async () => {
    expect(names(await search('?verified=true').expect(200))).toEqual(['Ama Pipes']);
    expect((await search('?verified=false').expect(200)).body.items).toHaveLength(5);
  });

  it('pages without overlap and reports hasMore', async () => {
    const page = (n: number) => search(`?${GEO}&limit=2&page=${n}`).expect(200);
    const p1 = await page(1);
    const p2 = await page(2);
    const p3 = await page(3);
    const p4 = await page(4);
    expect(names(p1)).toEqual(['Kofi Plumbing', 'Yaw Electric']);
    expect(p1.body.hasMore).toBe(true);
    expect(names(p2)).toEqual(['Ama Pipes', 'Sparkle Cleaners']);
    expect(p2.body.hasMore).toBe(true);
    expect(names(p3)).toEqual(['Far Fix']);
    expect(p3.body.hasMore).toBe(false);
    expect(p4.body.items).toEqual([]);
    expect(p4.body.hasMore).toBe(false);
  });

  it('validates the query', async () => {
    const bad = async (qs: string) => (await search(qs).expect(400)).body;
    expect((await bad('?lat=5.6')).details).toHaveProperty('lng');
    expect((await bad('?lng=-0.18')).details).toHaveProperty('lat');
    expect((await bad('?lat=91&lng=0')).details).toHaveProperty('lat');
    expect((await bad('?lat=abc&lng=0')).details).toHaveProperty('lat');
    expect((await bad('?radiusKm=5')).details).toHaveProperty('radiusKm');
    expect((await bad('?sort=distance')).details).toHaveProperty('sort');
    expect((await bad('?sort=newest')).details).toHaveProperty('sort');
    expect((await bad('?limit=500')).details).toHaveProperty('limit');
    expect((await bad('?page=0')).details).toHaveProperty('page');
    expect((await bad('?professionId=nope')).details).toHaveProperty('professionId');
    expect((await bad('?verified=maybe')).details).toHaveProperty('verified');
    expect((await bad('?colour=red')).details).toHaveProperty('colour');
  });

  it('hides suspended and deleted accounts', async () => {
    const yaw = pros.yaw.user.user.id;
    const kofi = pros.kofi.user.user.id;
    try {
      await ctx.prisma.user.update({ where: { id: kofi }, data: { status: 'suspended' } });
      await ctx.prisma.user.update({ where: { id: yaw }, data: { deletedAt: new Date() } });
      expect(names(await search().expect(200))).toEqual([
        'Sparkle Cleaners', 'Ama Pipes', 'Far Fix',
      ]);
      await get(customer, `/v1/professionals/${pros.kofi.profileId}`).expect(404);
    } finally {
      await ctx.prisma.user.update({ where: { id: kofi }, data: { status: 'active' } });
      await ctx.prisma.user.update({ where: { id: yaw }, data: { deletedAt: null } });
    }
    expect((await search().expect(200)).body.items).toHaveLength(5);
  });

  it('never shows a user their own professional profile', async () => {
    await onboardCustomer(ctx, pros.far.user, [plumberId]); // far is now both roles
    const res = await search('', pros.far.user).expect(200);
    expect(names(res)).not.toContain('Far Fix');
    expect(res.body.items).toHaveLength(4);
    await get(pros.far.user, `/v1/professionals/${pros.far.profileId}`).expect(404);
  });

  it('returns cards with the fields the app expects', async () => {
    const res = await search(`?${GEO}`).expect(200);
    const kofi = res.body.items[0];
    expect(Object.keys(kofi).sort()).toEqual([
      'avatar', 'description', 'distanceKm', 'id', 'inServiceArea', 'isSaved', 'joined',
      'latitude', 'longitude', 'name', 'online', 'operationalRadiusKm', 'ownerName', 'phone',
      'profession', 'professionId', 'rating', 'ratingCount', 'verified',
    ]);
    expect(kofi).toMatchObject({
      id: pros.kofi.profileId,
      name: 'Kofi Plumbing',
      ownerName: 'Kofi Plumbing Owner',
      profession: 'Plumber',
      rating: 4.5,
      ratingCount: 30,
      verified: false,
      online: false,
      isSaved: false,
      latitude: 5.605,
      longitude: -0.187,
      joined: new Date().getUTCFullYear(),
    });
    const ama = res.body.items.find((i: { name: string }) => i.name === 'Ama Pipes');
    expect(ama.verified).toBe(true);
  });

  describe('GET /professionals/:id', () => {
    it('returns the full profile', async () => {
      const k = pros.kofi;
      const res = await get(customer, `/v1/professionals/${k.profileId}?${GEO}`).expect(200);
      expect(res.body).toMatchObject({
        id: k.profileId,
        name: 'Kofi Plumbing',
        profession: 'Plumber',
        isSaved: false,
        address: null,
        portfolio: [],
        reviews: [],
      });
      expect(res.body.distanceKm).toBeGreaterThan(0);
      expect(res.body.distanceKm).toBeLessThan(1);
      expect(
        res.body.services.map((s: { name: string; rate: number; unit: string; currency: string }) => [
          s.name, s.rate, s.unit, s.currency,
        ]),
      ).toEqual([
        ['Call-out', 12.5, 'hr', 'GHS'],
        ['Pipe Replacement', 120, 'job', 'GHS'],
      ]);
      expect(res.body.workingDays).toHaveLength(7);
      expect(res.body.workingDays[0]).toEqual({
        dayOfWeek: 0, isOpen: false, opensAt: null, closesAt: null,
      });
      expect(res.body.workingDays[1]).toEqual({
        dayOfWeek: 1, isOpen: true, opensAt: '08:00', closesAt: '18:00',
      });
    });

    it('works without a location, and rejects bad ids', async () => {
      const res = await get(customer, `/v1/professionals/${pros.ama.profileId}`).expect(200);
      expect(res.body.distanceKm).toBeNull();
      expect(res.body.verified).toBe(true);

      const missing = await get(customer, '/v1/professionals/00000000-0000-4000-8000-000000000000').expect(404);
      expect(missing.body.code).toBe('NOT_FOUND');
      await get(customer, '/v1/professionals/not-a-uuid').expect(400);
      await get(customer, `/v1/professionals/${pros.ama.profileId}?lat=5.6`).expect(400);
      await ctx.api().get(`/v1/professionals/${pros.ama.profileId}`).expect(401);
    });
  });
});