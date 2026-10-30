import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { StorageService } from '../src/modules/uploads/storage/storage.service';
import {
  AuthBody, bearer, createTestApp, proBody, registerUser, seedProfessions, TestCtx,
} from './helpers';

const PNG = Buffer.from('89504e470d0a1a0a0000', 'hex');

describe('uploads and avatars (e2e)', () => {
  let ctx: TestCtx;
  let storage: StorageService;
  let professionId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    storage = ctx.app.get(StorageService);
    professionId = (await seedProfessions(ctx))[0].id;
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => ctx.reset());

  const presign = (user: AuthBody, body: object) =>
    ctx.api().post('/v1/uploads/presign').set(bearer(user.accessToken)).send(body);

  const putTo = (uploadUrl: string, contentType: string, bytes: Buffer) => {
    const u = new URL(uploadUrl);
    return ctx.api().put(u.pathname + u.search).set('Content-Type', contentType).send(bytes);
  };

  async function uploadAvatar(user: AuthBody, bytes = PNG) {
    const res = await presign(user, {
      purpose: 'avatar',
      contentType: 'image/png',
      sizeBytes: bytes.length,
    }).expect(201);
    await putTo(res.body.uploadUrl, 'image/png', bytes).expect(204);
    return ctx.prisma.upload.findUniqueOrThrow({ where: { id: res.body.uploadId } });
  }

  const setAvatar = (user: AuthBody, id: string | null) =>
    ctx.api().patch('/v1/me').set(bearer(user.accessToken)).send({ avatarUploadId: id });

  const makePro = async (user: AuthBody) => {
    await ctx.api().post('/v1/me/professional-profile').set(bearer(user.accessToken))
      .send(proBody(professionId)).expect(201);
  };

  it('requires a token', async () => {
    await ctx.api().post('/v1/uploads/presign').send({}).expect(401);
  });

  it('rejects a bad purpose, type and size with field errors', async () => {
    const user = await registerUser(ctx);
    const badPurpose = await presign(user, { purpose: 'banner', contentType: 'image/png', sizeBytes: 10 }).expect(400);
    expect(badPurpose.body.details).toHaveProperty('purpose');

    const gif = await presign(user, { purpose: 'avatar', contentType: 'image/gif', sizeBytes: 10 }).expect(400);
    expect(gif.body.details).toHaveProperty('contentType');

    const pdfAvatar = await presign(user, { purpose: 'avatar', contentType: 'application/pdf', sizeBytes: 10 }).expect(400);
    expect(pdfAvatar.body.details).toHaveProperty('contentType');

    const big = await presign(user, { purpose: 'avatar', contentType: 'image/png', sizeBytes: 6_000_000 }).expect(400);
    expect(big.body.details).toHaveProperty('sizeBytes');

    await presign(user, { purpose: 'avatar', contentType: 'image/png', sizeBytes: 0 }).expect(400);
  });

  it('only professionals can presign portfolio and verification uploads', async () => {
    const user = await registerUser(ctx);
    for (const purpose of ['portfolio', 'verification']) {
      const res = await presign(user, { purpose, contentType: 'image/png', sizeBytes: 100 }).expect(403);
      expect(res.body.code).toBe('ROLE_NOT_ONBOARDED');
    }
    await makePro(user);
    await presign(user, { purpose: 'portfolio', contentType: 'image/png', sizeBytes: 100 }).expect(201);
    await presign(user, { purpose: 'verification', contentType: 'application/pdf', sizeBytes: 100 }).expect(201);
  });

  it('returns an upload target and records a pending upload', async () => {
    const user = await registerUser(ctx);
    const res = await presign(user, { purpose: 'avatar', contentType: 'image/png', sizeBytes: PNG.length }).expect(201);
    expect(res.body).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'image/png' } });
    expect(res.body.uploadUrl).toContain('/v1/uploads/local');
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const row = await ctx.prisma.upload.findUniqueOrThrow({ where: { id: res.body.uploadId } });
    expect(row).toMatchObject({
      userId: user.user.id,
      purpose: 'avatar',
      status: 'pending',
      contentType: 'image/png',
      sizeBytes: PNG.length,
    });
    expect(row.key).toBe(`avatar/${user.user.id}/${row.id}.png`);
  });

  it('rejects a bad signature, content type and length on the local upload endpoint', async () => {
    const user = await registerUser(ctx);
    const res = await presign(user, { purpose: 'avatar', contentType: 'image/png', sizeBytes: PNG.length }).expect(201);
    const url: string = res.body.uploadUrl;
    const row = await ctx.prisma.upload.findUniqueOrThrow({ where: { id: res.body.uploadId } });

    const tampered = await putTo(url.replace(/sig=[0-9a-f]+/, 'sig=00'), 'image/png', PNG).expect(403);
    expect(tampered.body.code).toBe('FORBIDDEN');
    await putTo(url, 'image/jpeg', PNG).expect(400);
    await putTo(url, 'image/png', Buffer.concat([PNG, PNG])).expect(400);
    expect(await storage.stat(row.key)).toBeNull();
  });

  it('stores the file when the upload is correct', async () => {
    const user = await registerUser(ctx);
    const row = await uploadAvatar(user);
    expect(await storage.stat(row.key)).toMatchObject({ sizeBytes: PNG.length });
  });

  it('keeps verification documents out of the public folder', async () => {
    const user = await registerUser(ctx);
    await makePro(user);
    const res = await presign(user, { purpose: 'verification', contentType: 'application/pdf', sizeBytes: 8 }).expect(201);
    await putTo(res.body.uploadUrl, 'application/pdf', Buffer.from('%PDF-1.4')).expect(204);
    const row = await ctx.prisma.upload.findUniqueOrThrow({ where: { id: res.body.uploadId } });

    const root = process.env.STORAGE_LOCAL_DIR!;
    expect(existsSync(join(root, 'private', row.key))).toBe(true);
    expect(existsSync(join(root, 'public', row.key))).toBe(false);
  });

  it('sets the avatar from an upload and marks it consumed', async () => {
    const user = await registerUser(ctx);
    const row = await uploadAvatar(user);

    const res = await setAvatar(user, row.id).expect(200);
    expect(res.body.user.avatarUrl).toBe(`http://localhost:3000/files/${row.key}`);

    const me = await ctx.api().get('/v1/me').set(bearer(user.accessToken)).expect(200);
    expect(me.body.user.avatarUrl).toBe(res.body.user.avatarUrl);
    expect((await ctx.prisma.upload.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('consumed');
  });

  it('rejects reused, foreign, wrong-purpose and unfinished uploads', async () => {
    const user = await registerUser(ctx);
    const other = await registerUser(ctx);

    // presigned but never uploaded
    const pending = await presign(user, { purpose: 'avatar', contentType: 'image/png', sizeBytes: PNG.length }).expect(201);
    const notReady = await setAvatar(user, pending.body.uploadId).expect(400);
    expect(notReady.body.code).toBe('UPLOAD_NOT_READY');

    // already used
    const used = await uploadAvatar(user);
    await setAvatar(user, used.id).expect(200);
    const reused = await setAvatar(user, used.id).expect(400);
    expect(reused.body.code).toBe('UPLOAD_INVALID');

    // someone else's upload
    const theirs = await uploadAvatar(other);
    const foreign = await setAvatar(user, theirs.id).expect(400);
    expect(foreign.body.code).toBe('UPLOAD_INVALID');

    // a portfolio upload cannot become an avatar
    await makePro(user);
    const res = await presign(user, { purpose: 'portfolio', contentType: 'image/png', sizeBytes: PNG.length }).expect(201);
    await putTo(res.body.uploadUrl, 'image/png', PNG).expect(204);
    const wrongPurpose = await setAvatar(user, res.body.uploadId).expect(400);
    expect(wrongPurpose.body.code).toBe('UPLOAD_INVALID');

    const badId = await setAvatar(user, 'not-a-uuid').expect(400);
    expect(badId.body.details).toHaveProperty('avatarUploadId');
  });

  it('replaces the avatar and deletes the old file', async () => {
    const user = await registerUser(ctx);
    const first = await uploadAvatar(user);
    await setAvatar(user, first.id).expect(200);

    const second = await uploadAvatar(user, Buffer.from('89504e470d0a1a0a000000', 'hex'));
    const res = await setAvatar(user, second.id).expect(200);

    expect(res.body.user.avatarUrl).toBe(`http://localhost:3000/files/${second.key}`);
    expect(await storage.stat(first.key)).toBeNull();
    expect(await ctx.prisma.upload.findUnique({ where: { id: first.id } })).toBeNull();
    expect(await storage.stat(second.key)).not.toBeNull();
  });

  it('clears the avatar with null and deletes the file', async () => {
    const user = await registerUser(ctx);
    const row = await uploadAvatar(user);
    await setAvatar(user, row.id).expect(200);

    const res = await setAvatar(user, null).expect(200);
    expect(res.body.user.avatarUrl).toBeNull();
    expect(await storage.stat(row.key)).toBeNull();
    expect(await ctx.prisma.upload.count({ where: { userId: user.user.id } })).toBe(0);
  });

  it('deletes uploaded files when the account is deleted', async () => {
    const user = await registerUser(ctx);
    const row = await uploadAvatar(user);
    await setAvatar(user, row.id).expect(200);

    await ctx.api().delete('/v1/me').set(bearer(user.accessToken))
      .send({ password: user.password }).expect(204);

    expect(await storage.stat(row.key)).toBeNull();
    expect(await ctx.prisma.upload.count({ where: { userId: user.user.id } })).toBe(0);
  });
});