import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthBody, bearer, createTestApp, registerUser, TestCtx } from './helpers';

const NOBODY = '00000000-0000-4000-8000-000000000000';

describe('notifications (e2e)', () => {
  let ctx: TestCtx;
  let a: AuthBody;
  let b: AuthBody;

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.reset();
    a = await registerUser(ctx);
    b = await registerUser(ctx);
  });
  beforeEach(() => ctx.prisma.notification.deleteMany());
  afterAll(async () => {
    await ctx.app.close();
  });

  const make = (userId: string, n: number, extra: object = {}) =>
    ctx.prisma.notification.create({
      data: {
        userId,
        kind: 'new_request',
        title: `T${n}`,
        message: `M${n}`,
        createdAt: new Date(Date.now() - n * 1000), // T1 is the newest
        ...extra,
      },
    });
  const list = (user: AuthBody, qs = '') =>
    ctx.api().get(`/v1/notifications${qs}`).set(bearer(user.accessToken));
  const titles = (res: { body: { items: { title: string }[] } }) => res.body.items.map((i) => i.title);

  it('requires a token', async () => {
    await ctx.api().get('/v1/notifications').expect(401);
    await ctx.api().post('/v1/notifications/read-all').expect(401);
    await ctx.api().patch(`/v1/notifications/${NOBODY}/read`).expect(401);
  });

  it('lists the newest first, with an accurate unread count, and only the user’s own', async () => {
    await make(a.user.id, 1);
    await make(a.user.id, 2);
    await make(a.user.id, 3, { readAt: new Date() });
    await make(b.user.id, 4);

    const res = await list(a).expect(200);
    expect(titles(res)).toEqual(['T1', 'T2', 'T3']);
    expect(res.body).toMatchObject({ page: 1, limit: 20, hasMore: false, unreadCount: 2 });
    expect(Object.keys(res.body.items[0]).sort()).toEqual([
      'data', 'date', 'id', 'kind', 'message', 'read', 'readAt', 'title',
    ]);
    expect(res.body.items.map((i: { read: boolean }) => i.read)).toEqual([false, false, true]);

    expect(titles(await list(b).expect(200))).toEqual(['T4']);
  });

  it('filters unread and pages with hasMore', async () => {
    for (let n = 1; n <= 5; n++) await make(a.user.id, n, n % 2 === 0 ? { readAt: new Date() } : {});

    const unread = await list(a, '?unread=true').expect(200);
    expect(titles(unread)).toEqual(['T1', 'T3', 'T5']);
    expect(unread.body.unreadCount).toBe(3);
    expect(titles(await list(a, '?unread=false').expect(200))).toHaveLength(5);

    const p1 = await list(a, '?limit=2&page=1').expect(200);
    const p3 = await list(a, '?limit=2&page=3').expect(200);
    expect(titles(p1)).toEqual(['T1', 'T2']);
    expect(p1.body.hasMore).toBe(true);
    expect(titles(p3)).toEqual(['T5']);
    expect(p3.body.hasMore).toBe(false);

    expect((await list(a, '?limit=500').expect(400)).body.details).toHaveProperty('limit');
    expect((await list(a, '?unread=maybe').expect(400)).body.details).toHaveProperty('unread');
  });

  it('marks as read and unread, idempotently', async () => {
    const n = await make(a.user.id, 1);
    const read = async () =>
      ctx.api().patch(`/v1/notifications/${n.id}/read`).set(bearer(a.accessToken)).expect(200);

    const first = await read();
    expect(first.body).toMatchObject({ id: n.id, read: true });
    const firstReadAt = first.body.readAt;
    expect((await read()).body.readAt).toBe(firstReadAt); // a second call keeps the original time

    const unread = await ctx.api().patch(`/v1/notifications/${n.id}/unread`).set(bearer(a.accessToken)).expect(200);
    expect(unread.body).toMatchObject({ read: false, readAt: null });
    await ctx.api().patch(`/v1/notifications/${n.id}/unread`).set(bearer(a.accessToken)).expect(200);
    expect((await list(a).expect(200)).body.unreadCount).toBe(1);
  });

  it('treats another user’s notification as missing, and validates ids', async () => {
    const theirs = await make(b.user.id, 1);
    const res = await ctx.api().patch(`/v1/notifications/${theirs.id}/read`).set(bearer(a.accessToken)).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    await ctx.api().patch(`/v1/notifications/${theirs.id}/unread`).set(bearer(a.accessToken)).expect(404);
    await ctx.api().patch(`/v1/notifications/${NOBODY}/read`).set(bearer(a.accessToken)).expect(404);
    await ctx.api().patch('/v1/notifications/not-a-uuid/read').set(bearer(a.accessToken)).expect(400);
    expect((await ctx.prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt).toBeNull();
  });

  it('marks only the caller’s notifications as read with read-all', async () => {
    await make(a.user.id, 1);
    await make(a.user.id, 2);
    await make(b.user.id, 3);

    const res = await ctx.api().post('/v1/notifications/read-all').set(bearer(a.accessToken)).expect(200);
    expect(res.body).toEqual({ updated: 2 });
    expect((await list(a).expect(200)).body.unreadCount).toBe(0);
    expect((await list(b).expect(200)).body.unreadCount).toBe(1);

    const again = await ctx.api().post('/v1/notifications/read-all').set(bearer(a.accessToken)).expect(200);
    expect(again.body).toEqual({ updated: 0 });
  });
});