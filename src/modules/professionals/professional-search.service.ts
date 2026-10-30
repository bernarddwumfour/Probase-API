import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { boundingBox, haversineKm } from '../../common/geo';
import { likePattern } from '../../common/sql';
import { PrismaService } from '../../prisma/prisma.service';
import { requireCustomerId } from './customer-id.util';
import type { GeoQueryDto } from './dto/geo-query.dto';
import type { SearchProfessionalsDto } from './dto/search-professionals.dto';
import { geoPoint } from './geo-params';
import {
  professionalInclude,
  toProfessionalCard,
  visibleProfessionalWhere,
} from './professional.mapper';
import { toServiceResponse } from './service.mapper';

@Injectable()
export class ProfessionalSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(userId: string, dto: SearchProfessionalsDto) {
    const geo = geoPoint(dto);
    if (!geo && dto.radiusKm !== undefined) {
      throw this.invalid('radiusKm', 'radiusKm requires lat and lng');
    }
    if (!geo && dto.sort === 'distance') {
      throw this.invalid('sort', 'sorting by distance requires lat and lng');
    }
    const sort = dto.sort ?? (geo ? 'distance' : 'rating');
    const customerId = await requireCustomerId(this.prisma, userId);

    const where: Prisma.Sql[] = [
      Prisma.sql`p."onboardedAt" IS NOT NULL`,
      Prisma.sql`u."status" = 'active'`,
      Prisma.sql`u."deletedAt" IS NULL`,
      Prisma.sql`p."userId" <> ${userId}::uuid`,
    ];
    if (dto.professionId) where.push(Prisma.sql`p."professionId" = ${dto.professionId}::uuid`);
    if (dto.verified === true) where.push(Prisma.sql`p."verificationStatus" = 'approved'`);

    const q = dto.q?.trim();
    if (q) {
      const pattern = likePattern(q);
      where.push(Prisma.sql`(
        p."businessName" ILIKE ${pattern}
        OR pr."name" ILIKE ${pattern}
        OR u."fullName" ILIKE ${pattern}
        OR EXISTS (
          SELECT 1 FROM "services" s
          WHERE s."professionalId" = p.id AND s."isActive" AND s."name" ILIKE ${pattern}
        )
      )`);
    }

    let distance = Prisma.sql`NULL::double precision`;
    let outerWhere = Prisma.empty;
    if (geo) {
      const lat = Prisma.sql`${geo.lat}::double precision`;
      const lng = Prisma.sql`${geo.lng}::double precision`;
      distance = Prisma.sql`(6371 * 2 * asin(sqrt(least(1,
        power(sin(radians(p."latitude" - ${lat}) / 2), 2)
        + cos(radians(${lat})) * cos(radians(p."latitude"))
          * power(sin(radians(p."longitude" - ${lng}) / 2), 2)))))`;

      if (dto.radiusKm !== undefined) {
        const box = boundingBox(geo.lat, geo.lng, dto.radiusKm);
        where.push(
          Prisma.sql`p."latitude" BETWEEN ${box.minLat}::double precision AND ${box.maxLat}::double precision`,
        );
        if (box.minLng !== undefined && box.maxLng !== undefined) {
          where.push(
            Prisma.sql`p."longitude" BETWEEN ${box.minLng}::double precision AND ${box.maxLng}::double precision`,
          );
        }
        outerWhere = Prisma.sql`WHERE t.distance_km <= ${dto.radiusKm}::double precision`;
      }
    }

    const orderBy =
      sort === 'distance'
        ? Prisma.sql`ORDER BY t.distance_km ASC, t.rating_avg DESC, t.id ASC`
        : geo
          ? Prisma.sql`ORDER BY t.rating_avg DESC, t.rating_count DESC, t.distance_km ASC, t.id ASC`
          : Prisma.sql`ORDER BY t.rating_avg DESC, t.rating_count DESC, t.id ASC`;

    const { page, limit } = dto;
    const rows = await this.prisma.$queryRaw<{ id: string; distance_km: number | null }[]>(Prisma.sql`
      SELECT t.id, t.distance_km
      FROM (
        SELECT p.id,
               ${distance} AS distance_km,
               p."ratingAverage" AS rating_avg,
               p."ratingCount" AS rating_count
        FROM "professional_profiles" p
        JOIN "users" u ON u.id = p."userId"
        JOIN "professions" pr ON pr.id = p."professionId"
        WHERE ${Prisma.join(where, ' AND ')}
      ) t
      ${outerWhere}
      ${orderBy}
      LIMIT ${limit + 1} OFFSET ${(page - 1) * limit}
    `);

    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const ids = pageRows.map((r) => r.id);

    const [profiles, saved] = ids.length
      ? await Promise.all([
          this.prisma.professionalProfile.findMany({
            where: { id: { in: ids } },
            include: professionalInclude,
          }),
          this.prisma.savedProfessional.findMany({
            where: { customerId, professionalId: { in: ids } },
            select: { professionalId: true },
          }),
        ])
      : [[], []];

    const byId = new Map(profiles.map((p) => [p.id, p]));
    const savedIds = new Set(saved.map((s) => s.professionalId));
    const items = pageRows.flatMap((r) => {
      const p = byId.get(r.id);
      return p
        ? [toProfessionalCard(p, { distanceKm: r.distance_km, isSaved: savedIds.has(r.id) })]
        : [];
    });

    return { items, page, limit, hasMore };
  }

  async getProfile(userId: string, id: string, query: GeoQueryDto) {
    const geo = geoPoint(query);
    const customerId = await requireCustomerId(this.prisma, userId);

    const p = await this.prisma.professionalProfile.findFirst({
      where: { id, ...visibleProfessionalWhere(userId) },
      include: {
        ...professionalInclude,
        services: { where: { isActive: true }, orderBy: { name: 'asc' } },
        workingDays: { orderBy: { dayOfWeek: 'asc' } },
      },
    });
    if (!p) throw new AppException(404, ErrorCode.NOT_FOUND, 'Professional not found');

    const isSaved =
      (await this.prisma.savedProfessional.count({
        where: { customerId, professionalId: id },
      })) > 0;

    return {
      ...toProfessionalCard(p, {
        isSaved,
        distanceKm: geo ? haversineKm(geo.lat, geo.lng, p.latitude, p.longitude) : null,
      }),
      address: p.address,
      services: p.services.map(toServiceResponse),
      workingDays: p.workingDays.map((d) => ({
        dayOfWeek: d.dayOfWeek,
        isOpen: d.isOpen,
        opensAt: d.opensAt,
        closesAt: d.closesAt,
      })),
      portfolio: [], // arrives with portfolio uploads
      reviews: [], // arrives with reviews
    };
  }

  private invalid(field: string, message: string) {
    return new AppException(400, ErrorCode.VALIDATION_FAILED, 'Validation failed', {
      [field]: [message],
    });
  }
}