import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { isPrivateKey } from '../upload.constants';
import type { StorageDriver, UploadTarget } from './storage.types';

export interface S3Options {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBucket: string;
  privateBucket: string;
  publicBaseUrl: string;
}

export class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client;

  constructor(private readonly o: S3Options) {
    this.client = new S3Client({
      region: o.region,
      endpoint: o.endpoint,
      forcePathStyle: !!o.endpoint, // needed for MinIO and most S3-compatible services
      credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey },
      // Newer SDK versions add checksum parameters to presigned URLs, which R2 and MinIO reject
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  private bucket(key: string) {
    return isPrivateKey(key) ? this.o.privateBucket : this.o.publicBucket;
  }

  async createUploadTarget(o: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<UploadTarget> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket(o.key),
        Key: o.key,
        ContentType: o.contentType,
        ContentLength: o.sizeBytes, // signed, so the client must send exactly this size
      }),
      { expiresIn: o.expiresInSeconds },
    );
    return { url, method: 'PUT', headers: { 'Content-Type': o.contentType } };
  }

  async stat(key: string) {
    try {
      const r = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket(key), Key: key }),
      );
      return { sizeBytes: r.ContentLength ?? 0, contentType: r.ContentType };
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  publicUrl(key: string) {
    return `${this.o.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }

  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket(key), Key: key }));
  }
}