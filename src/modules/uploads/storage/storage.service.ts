import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import type { Env } from '../../../config/env.schema';
import { LocalStorageDriver, LocalUploadQuery } from './local-storage.driver';
import { S3StorageDriver } from './s3-storage.driver';
import type { StorageDriver } from './storage.types';

@Injectable()
export class StorageService {
  private readonly driver: StorageDriver;
  private readonly local?: LocalStorageDriver;

  constructor(config: ConfigService<Env, true>) {
    const get = <K extends keyof Env>(k: K) => config.get(k, { infer: true });

    if (get('STORAGE_DRIVER') === 's3') {
      this.driver = new S3StorageDriver({
        endpoint: get('S3_ENDPOINT'),
        region: get('S3_REGION'),
        accessKeyId: get('S3_ACCESS_KEY_ID')!,
        secretAccessKey: get('S3_SECRET_ACCESS_KEY')!,
        publicBucket: get('S3_PUBLIC_BUCKET')!,
        privateBucket: get('S3_PRIVATE_BUCKET')!,
        publicBaseUrl: get('S3_PUBLIC_BASE_URL')!,
      });
    } else {
      this.local = new LocalStorageDriver({
        dir: get('STORAGE_LOCAL_DIR'),
        baseUrl: get('PUBLIC_BASE_URL'),
        secret: get('JWT_ACCESS_SECRET'),
      });
      this.driver = this.local;
    }
  }

  /** Folder to serve at /files when using the local driver. */
  get localPublicDir() {
    return this.local?.publicDir;
  }

  createUploadTarget(o: Parameters<StorageDriver['createUploadTarget']>[0]) {
    return this.driver.createUploadTarget(o);
  }
  stat(key: string) {
    return this.driver.stat(key);
  }
  publicUrl(key: string) {
    return this.driver.publicUrl(key);
  }
  remove(key: string) {
    return this.driver.remove(key);
  }

  receiveLocal(q: LocalUploadQuery, req: Request) {
    if (!this.local) throw new AppException(404, ErrorCode.NOT_FOUND, 'Not found');
    return this.local.receive(q, req);
  }
}