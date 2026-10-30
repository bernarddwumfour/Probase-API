import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, Upload, UploadPurpose } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import { PresignDto } from './dto/presign.dto';
import { StorageService } from './storage/storage.service';
import {
  CONSUME_WINDOW_MS,
  EXTENSIONS,
  UPLOAD_RULES,
  URL_TTL_SECONDS,
} from './upload.constants';

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ---------- presign ----------

  async presign(userId: string, dto: PresignDto) {
    const rule = UPLOAD_RULES[dto.purpose];
    const errors: Record<string, string[]> = {};
    if (!rule.types.includes(dto.contentType)) {
      errors.contentType = [`must be one of: ${rule.types.join(', ')}`];
    }
    if (dto.sizeBytes > rule.maxBytes) {
      errors.sizeBytes = [`must be at most ${rule.maxBytes} bytes for ${dto.purpose} uploads`];
    }
    if (Object.keys(errors).length) {
      throw new AppException(400, ErrorCode.VALIDATION_FAILED, 'Validation failed', errors);
    }

    if (dto.purpose !== 'avatar') await this.requireProfessional(userId);

    const id = randomUUID();
    const key = `${dto.purpose}/${userId}/${id}.${EXTENSIONS[dto.contentType]}`;
    await this.prisma.upload.create({
      data: {
        id,
        userId,
        purpose: dto.purpose,
        key,
        contentType: dto.contentType,
        sizeBytes: dto.sizeBytes,
        expiresAt: new Date(Date.now() + CONSUME_WINDOW_MS),
      },
    });

    const target = await this.storage.createUploadTarget({
      key,
      contentType: dto.contentType,
      sizeBytes: dto.sizeBytes,
      expiresInSeconds: URL_TTL_SECONDS,
    });

    return {
      uploadId: id,
      method: target.method,
      uploadUrl: target.url,
      headers: target.headers,
      expiresAt: new Date(Date.now() + URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  private async requireProfessional(userId: string) {
    const profile = await this.prisma.professionalProfile.findFirst({
      where: { userId, onboardedAt: { not: null } },
      select: { id: true },
    });
    if (!profile) {
      throw new AppException(
        403,
        ErrorCode.ROLE_NOT_ONBOARDED,
        'Complete professional onboarding to use this feature',
        { role: 'professional' },
      );
    }
  }

  // ---------- attaching an upload to something ----------

  /** Checks the upload belongs to the user, is unused, and really arrived intact. */
  async verify(userId: string, uploadId: string, purpose: UploadPurpose): Promise<Upload> {
    const row = await this.prisma.upload.findFirst({
      where: { id: uploadId, userId, purpose, status: 'pending', expiresAt: { gt: new Date() } },
    });
    if (!row) {
      throw new AppException(
        400,
        ErrorCode.UPLOAD_INVALID,
        'The upload is unknown, expired, already used or for something else',
      );
    }

    const file = await this.storage.stat(row.key);
    const wrongType = file?.contentType && file.contentType !== row.contentType;
    if (!file || file.sizeBytes !== row.sizeBytes || wrongType) {
      throw new AppException(
        400,
        ErrorCode.UPLOAD_NOT_READY,
        'The file was not uploaded, or does not match what was declared',
      );
    }
    return row;
  }

  /** Call inside the same transaction that attaches the file. Fails if someone else got there first. */
  async markConsumed(tx: Prisma.TransactionClient, uploadId: string) {
    const { count } = await tx.upload.updateMany({
      where: { id: uploadId, status: 'pending' },
      data: { status: 'consumed' },
    });
    if (count !== 1) {
      throw new AppException(400, ErrorCode.UPLOAD_INVALID, 'The upload was already used');
    }
  }

  publicUrl(key: string) {
    return this.storage.publicUrl(key);
  }

  // ---------- cleanup ----------

  async discardOldAvatars(userId: string, keepId?: string) {
    const rows = await this.prisma.upload.findMany({
      where: {
        userId,
        purpose: 'avatar',
        status: 'consumed',
        ...(keepId ? { id: { not: keepId } } : {}),
      },
    });
    await this.removeRows(rows);
  }

  async deleteAllForUser(userId: string) {
    const rows = await this.prisma.upload.findMany({ where: { userId } });
    await this.removeRows(rows);
  }

  /** Never throws. Rows whose file could not be removed stay, so a later pass can retry. */
  private async removeRows(rows: Upload[]) {
    const removed: string[] = [];
    for (const row of rows) {
      try {
        await this.storage.remove(row.key);
        removed.push(row.id);
      } catch (err) {
        this.logger.warn({ err, key: row.key }, 'Failed to delete stored file');
      }
    }
    if (removed.length) await this.prisma.upload.deleteMany({ where: { id: { in: removed } } });
  }
}