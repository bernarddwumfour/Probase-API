import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { haversineKm } from '../../common/geo';
import { PrismaService } from '../../prisma/prisma.service';
import { requireCustomerId } from './customer-id.util';
import type { SavedListQueryDto } from './dto/saved-list-query.dto';
import { geoPoint } from './geo-params';
import {
  professionalInclude,
  toProfessionalCard,
  visibleProfessionalWhere,
} from './professional.mapper';

@Injectable()
export class SavedProfessionalsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: SavedListQueryDto) {
    const geo = geoPoint(query);
    const customerId = await requireCustomerId(this.prisma, userId);
    const { page, limit } = query;

    const rows = await this.prisma.savedProfessional.findMany({
      where: { customerId, professional: visibleProfessionalWhere(userId) },
      orderBy: [{ createdAt: 'desc' }, { professionalId: 'asc' }],
      skip: (page - 1) * limit,
      take: limit + 1,
      include: { professional: { include: professionalInclude } },
    });

    const items = rows.slice(0, limit).map((r) =>
      toProfessionalCard(r.professional, {
        isSaved: true,
        distanceKm: geo
          ? haversineKm(geo.lat, geo.lng, r.professional.latitude, r.professional.longitude)
          : null,
      }),
    );
    return { items, page, limit, hasMore: rows.length > limit };
  }

  /** Idempotent: saving twice is fine. */
  async save(userId: string, professionalId: string) {
    const customerId = await requireCustomerId(this.prisma, userId);
    const visible = await this.prisma.professionalProfile.findFirst({
      where: { id: professionalId, ...visibleProfessionalWhere(userId) },
      select: { id: true },
    });
    if (!visible) throw new AppException(404, ErrorCode.NOT_FOUND, 'Professional not found');

    await this.prisma.savedProfessional.createMany({
      data: [{ customerId, professionalId }],
      skipDuplicates: true, // also settles two simultaneous saves
    });
  }

  /** Idempotent: removing something that is not saved is fine. */
  async remove(userId: string, professionalId: string) {
    const customerId = await requireCustomerId(this.prisma, userId);
    await this.prisma.savedProfessional.deleteMany({ where: { customerId, professionalId } });
  }
}