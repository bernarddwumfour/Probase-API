import { createHmac, timingSafeEqual } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request } from 'express';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { isPrivateKey } from '../upload.constants';
import type { StorageDriver, UploadTarget } from './storage.types';

export interface LocalUploadQuery {
  key?: string;
  exp?: string;
  size?: string;
  type?: string;
  sig?: string;
}

export class LocalStorageDriver implements StorageDriver {
  readonly publicDir: string;
  private readonly privateDir: string;

  constructor(private readonly o: { dir: string; baseUrl: string; secret: string }) {
    const root = resolve(o.dir);
    this.publicDir = join(root, 'public');
    this.privateDir = join(root, 'private');
  }

  private path(key: string) {
    const base = isPrivateKey(key) ? this.privateDir : this.publicDir;
    const full = resolve(base, key);
    if (!full.startsWith(base + sep)) throw new Error('Invalid storage key');
    return full;
  }

  private sign(p: { key: string; exp: number; size: number; type: string }) {
    return createHmac('sha256', `upload-link:${this.o.secret}`)
      .update(`${p.key}|${p.exp}|${p.size}|${p.type}`)
      .digest('hex');
  }

  async createUploadTarget(o: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<UploadTarget> {
    const exp = Math.floor(Date.now() / 1000) + o.expiresInSeconds;
    const sig = this.sign({ key: o.key, exp, size: o.sizeBytes, type: o.contentType });
    const qs = new URLSearchParams({
      key: o.key,
      exp: String(exp),
      size: String(o.sizeBytes),
      type: o.contentType,
      sig,
    });
    return {
      url: `${this.o.baseUrl.replace(/\/$/, '')}/v1/uploads/local?${qs}`,
      method: 'PUT',
      headers: { 'Content-Type': o.contentType },
    };
  }

  /** Receives the file the app PUTs to the signed local URL. */
  async receive(q: LocalUploadQuery, req: Request): Promise<void> {
    const forbidden = () =>
      new AppException(403, ErrorCode.FORBIDDEN, 'Invalid or expired upload link');
    const bad = (message: string) =>
      new AppException(400, ErrorCode.VALIDATION_FAILED, message);

    const { key, exp, size, type, sig } = q;
    if (!key || !exp || !size || !type || !sig) throw forbidden();

    const expNum = Number(exp);
    const sizeNum = Number(size);
    if (!Number.isInteger(expNum) || !Number.isInteger(sizeNum) || expNum * 1000 < Date.now()) {
      throw forbidden();
    }
    const expected = Buffer.from(this.sign({ key, exp: expNum, size: sizeNum, type }), 'hex');
    const actual = Buffer.from(sig, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw forbidden();

    const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim();
    if (contentType !== type) throw bad('Content-Type does not match the upload');
    if (Number(req.headers['content-length']) !== sizeNum) {
      throw bad('Content-Length does not match the upload');
    }

    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });

    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        if (received > sizeNum) return cb(new Error('Body larger than declared'));
        cb(null, chunk);
      },
    });

    try {
      await pipeline(req, limiter, createWriteStream(target));
    } catch {
      await rm(target, { force: true });
      throw bad('Upload failed');
    }
    if (received !== sizeNum) {
      await rm(target, { force: true });
      throw bad('Body smaller than declared');
    }
  }

  async stat(key: string) {
    try {
      const s = await stat(this.path(key));
      return { sizeBytes: s.size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  publicUrl(key: string) {
    return `${this.o.baseUrl.replace(/\/$/, '')}/files/${key}`;
  }

  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
}