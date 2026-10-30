import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Request } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalStorageDriver, LocalUploadQuery } from './local-storage.driver';

const KEY = 'avatar/user-1/file.png';
const BODY = Buffer.from('0123456789');

const fakeReq = (body: Buffer, headers: Record<string, string>) =>
  Object.assign(Readable.from([body]), { headers }) as unknown as Request;

describe('LocalStorageDriver', () => {
  let dir: string;
  let driver: LocalStorageDriver;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'probase-local-'));
    driver = new LocalStorageDriver({
      dir,
      baseUrl: 'http://localhost:3000',
      secret: 'unit-test-secret-unit-test-secret-1234',
    });
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const query = async (ttl = 600): Promise<LocalUploadQuery> => {
    const target = await driver.createUploadTarget({
      key: KEY,
      contentType: 'image/png',
      sizeBytes: BODY.length,
      expiresInSeconds: ttl,
    });
    return Object.fromEntries(new URL(target.url).searchParams) as LocalUploadQuery;
  };
  const headers = (over: Record<string, string> = {}) => ({
    'content-type': 'image/png',
    'content-length': String(BODY.length),
    ...over,
  });
  const exists = () =>
    stat(join(dir, 'public', KEY)).then(
      () => true,
      () => false,
    );

  it('stores the file when the link, type and length all match', async () => {
    await driver.receive(await query(), fakeReq(BODY, headers()));
    expect(await driver.stat(KEY)).toMatchObject({ sizeBytes: BODY.length });
    await driver.remove(KEY);
    expect(await driver.stat(KEY)).toBeNull();
  });

  it('rejects a tampered signature', async () => {
    const q = await query();
    await expect(
      driver.receive({ ...q, sig: '00' + q.sig!.slice(2) }, fakeReq(BODY, headers())),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await exists()).toBe(false);
  });

  it('rejects a changed key even with the original signature', async () => {
    const q = await query();
    await expect(
      driver.receive({ ...q, key: 'avatar/user-2/file.png' }, fakeReq(BODY, headers())),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects an expired link', async () => {
    await expect(driver.receive(await query(-10), fakeReq(BODY, headers()))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rejects a different content type', async () => {
    await expect(
      driver.receive(await query(), fakeReq(BODY, headers({ 'content-type': 'image/jpeg' }))),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a wrong content length header', async () => {
    await expect(
      driver.receive(await query(), fakeReq(BODY, headers({ 'content-length': '99' }))),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects and deletes a body larger than declared', async () => {
    await expect(
      driver.receive(await query(), fakeReq(Buffer.concat([BODY, BODY]), headers())),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await exists()).toBe(false);
  });

  it('rejects and deletes a body smaller than declared', async () => {
    await expect(
      driver.receive(await query(), fakeReq(BODY.subarray(0, 4), headers())),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await exists()).toBe(false);
  });
});