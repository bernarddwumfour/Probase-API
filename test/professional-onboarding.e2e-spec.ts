import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bearer, createTestApp, onboardCustomer, proBody, registerUser, seedProfessions,
  TestCtx, workingWeek,
} from './helpers';

describe('professional onboarding (e2e)', () => {
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

  const post = (token: string, body: object) =>
    ctx.api().post('/v1/me/professional-profile').set(bearer(token)).send(body);

  it('requires a token', async () => {
    await ctx.api().post('/v1/me/professional-profile').send({}).expect(401);
  });

  it('reports every missing field', async () => {
    const user = await registerUser(ctx);
    const res = await post(user.accessToken, {}).expect(400);
    expect(Object.keys(res.body.details)).toEqual(
      expect.arrayContaining(['businessName', 'professionId', 'latitude', 'longitude', 'workingDays']),
    );
  });

  it('rejects unknown and inactive professions', async () => {
    const user = await registerUser(ctx);
    const unknown = await post(
      user.accessToken,
      proBody('00000000-0000-4000-8000-000000000000'),
    ).expect(400);
    expect(unknown.body.details.professionId).toBeDefined();

    await ctx.prisma.profession.update({ where: { slug: 'plumber' }, data: { active: false } });
    await post(user.accessToken, proBody(professionIds[0])).expect(400);
    await ctx.prisma.profession.update({ where: { slug: 'plumber' }, data: { active: true } });
  });

  it('enforces the working-day rules with field paths', async () => {
    const user = await registerUser(ctx);
    const send = (workingDays: object[]) =>
      post(user.accessToken, proBody(professionIds[0], { workingDays }));

    await send(workingWeek().slice(0, 6)).expect(400);

    const dup = workingWeek();
    dup[3] = { ...dup[3], dayOfWeek: 2 };
    expect(Object.keys((await send(dup).expect(400)).body.details)).toContain('workingDays.3.dayOfWeek');

    const noTimes = workingWeek({ 1: { isOpen: true, opensAt: undefined, closesAt: undefined } });
    expect(Object.keys((await send(noTimes).expect(400)).body.details)).toContain('workingDays.1.opensAt');

    const backwards = workingWeek({ 2: { opensAt: '18:00', closesAt: '08:00' } });
    expect(Object.keys((await send(backwards).expect(400)).body.details)).toContain('workingDays.2.closesAt');

    const badFormat = workingWeek({ 1: { opensAt: '8am' } });
    expect(Object.keys((await send(badFormat).expect(400)).body.details)).toContain('workingDays.1.opensAt');

    expect(await ctx.prisma.professionalProfile.count()).toBe(0);
  });

  it('validates services, units and rates', async () => {
    const user = await registerUser(ctx);
    const res = await post(
      user.accessToken,
      proBody(professionIds[0], {
        services: [
          { name: 'Pipe Replacement', rate: -5, unit: 'hour' },
          { name: 'Leak Repair', rate: 10.123, unit: 'hr' },
        ],
      }),
    ).expect(400);
    expect(Object.keys(res.body.details)).toEqual(
      expect.arrayContaining(['services.0.rate', 'services.0.unit', 'services.1.rate']),
    );
  });

  it('creates the profile, days and services, and activates the role', async () => {
    const user = await registerUser(ctx);
    const res = await post(
      user.accessToken,
      proBody(professionIds[0], {
        description: 'Fast and tidy.',
        operationalRadiusKm: 10,
        workingDays: workingWeek({ 0: { isOpen: false, opensAt: '09:00', closesAt: '12:00' } }),
        services: [
          { name: 'Pipe Replacement', rate: 120, unit: 'job' },
          { name: 'Call-out', description: 'Diagnosis', rate: 12.5, unit: 'hr' },
        ],
      }),
    ).expect(201);

    expect(res.body.activeRole).toBe('professional');
    expect(res.body.onboarded).toEqual({ customer: false, professional: true });

    const profile = await ctx.prisma.professionalProfile.findUniqueOrThrow({
      where: { userId: user.user.id },
      include: { workingDays: { orderBy: { dayOfWeek: 'asc' } }, services: { orderBy: { name: 'asc' } } },
    });
    expect(profile.onboardedAt).not.toBeNull();
    expect(profile.verificationStatus).toBe('unverified');
    expect(profile.operationalRadiusKm).toBe(10);
    expect(profile.workingDays).toHaveLength(7);
    // Hours sent for a closed day are discarded
    expect(profile.workingDays[0]).toMatchObject({ isOpen: false, opensAt: null, closesAt: null });
    expect(profile.workingDays[1]).toMatchObject({ isOpen: true, opensAt: '08:00', closesAt: '18:00' });
    expect(profile.services.map((s) => [s.name, s.rateUnit, s.currency])).toEqual([
      ['Call-out', 'hour', 'GHS'],
      ['Pipe Replacement', 'job', 'GHS'],
    ]);
    expect(Number(profile.services[0].rate)).toBe(12.5);

    const me = await ctx.api().get('/v1/me').set(bearer(user.accessToken)).expect(200);
    expect(me.body.activeRole).toBe('professional');
    expect(me.body.onboarded.professional).toBe(true);
  });

  it('works with only the required fields', async () => {
    const user = await registerUser(ctx);
    await post(user.accessToken, proBody(professionIds[0])).expect(201);
    const profile = await ctx.prisma.professionalProfile.findUniqueOrThrow({
      where: { userId: user.user.id },
      include: { services: true },
    });
    expect(profile.operationalRadiusKm).toBe(5);
    expect(profile.services).toHaveLength(0);
  });

  it('returns 409 ALREADY_ONBOARDED the second time and changes nothing', async () => {
    const user = await registerUser(ctx);
    const body = proBody(professionIds[0], { services: [{ name: 'Call-out', rate: 10, unit: 'hr' }] });
    await post(user.accessToken, body).expect(201);
    const again = await post(user.accessToken, body).expect(409);
    expect(again.body.code).toBe('ALREADY_ONBOARDED');
    expect(await ctx.prisma.service.count()).toBe(1);
  });

  it('lets only one of two simultaneous submissions win', async () => {
    const user = await registerUser(ctx);
    const send = () => post(user.accessToken, proBody(professionIds[0]));
    const results = await Promise.all([send(), send()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await ctx.prisma.professionalProfile.count()).toBe(1);
    expect(await ctx.prisma.workingDay.count()).toBe(7);
  });

  it('lets one account hold both roles and switch between them', async () => {
    const user = await registerUser(ctx);
    await onboardCustomer(ctx, user, [professionIds[0]]);
    await post(user.accessToken, proBody(professionIds[0])).expect(201);

    const me = await ctx.api().get('/v1/me').set(bearer(user.accessToken)).expect(200);
    expect(me.body.activeRole).toBe('professional');
    expect(me.body.onboarded).toEqual({ customer: true, professional: true });

    const back = await ctx.api().put('/v1/me/active-role').set(bearer(user.accessToken))
      .send({ role: 'customer' }).expect(200);
    expect(back.body.activeRole).toBe('customer');
  });
});