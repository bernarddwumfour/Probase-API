import { Injectable } from '@nestjs/common';
import { MAX_SAVED_LOCATIONS } from '../../common/constants';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { SetPreferredProfessionsDto } from './dto/set-preferred-professions.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { toLocationResponse } from './location.mapper';

@Injectable()
export class CustomerSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async customerId(userId: string) {
    const profile = await this.prisma.customerProfile.findFirst({
      where: { userId, onboardedAt: { not: null } },
      select: { id: true },
    });
    if (!profile) {
      throw new AppException(
        403,
        ErrorCode.ROLE_NOT_ONBOARDED,
        'Complete customer onboarding to use this feature',
        { role: 'customer' },
      );
    }
    return profile.id;
  }

  private notFound() {
    return new AppException(404, ErrorCode.NOT_FOUND, 'Location not found');
  }

  // ---------- locations ----------

  async listLocations(userId: string) {
    const customerId = await this.customerId(userId);
    const rows = await this.prisma.savedLocation.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return { items: rows.map(toLocationResponse) };
  }

  async createLocation(userId: string, dto: CreateLocationDto) {
    const customerId = await this.customerId(userId);
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.savedLocation.count({ where: { customerId } });
      if (count >= MAX_SAVED_LOCATIONS) {
        throw new AppException(
          422,
          ErrorCode.LOCATION_LIMIT_REACHED,
          `You can save up to ${MAX_SAVED_LOCATIONS} locations`,
        );
      }

      // The first location is always the default
      const makeDefault = count === 0 || dto.isDefault === true;
      if (makeDefault) {
        await tx.savedLocation.updateMany({
          where: { customerId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const row = await tx.savedLocation.create({
        data: {
          customerId,
          name: dto.name,
          latitude: dto.latitude,
          longitude: dto.longitude,
          address: dto.address,
          searchRadiusKm: dto.searchRadiusKm ?? 2,
          isDefault: makeDefault,
        },
      });
      return toLocationResponse(row);
    });
  }

  async updateLocation(userId: string, id: string, dto: UpdateLocationDto) {
    const customerId = await this.customerId(userId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.savedLocation.findFirst({ where: { id, customerId } });
      if (!existing) throw this.notFound();

      if (dto.isDefault) {
        // Unset the old default first; the database allows only one
        await tx.savedLocation.updateMany({
          where: { customerId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      const row = await tx.savedLocation.update({
        where: { id },
        data: {
          name: dto.name,
          latitude: dto.latitude,
          longitude: dto.longitude,
          address: dto.address, // null clears it
          searchRadiusKm: dto.searchRadiusKm,
          ...(dto.isDefault ? { isDefault: true } : {}),
        },
      });
      return toLocationResponse(row);
    });
  }

  async deleteLocation(userId: string, id: string) {
    const customerId = await this.customerId(userId);
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.savedLocation.findFirst({ where: { id, customerId } });
      if (!existing) throw this.notFound();

      await tx.savedLocation.delete({ where: { id } });

      if (existing.isDefault) {
        const next = await tx.savedLocation.findFirst({
          where: { customerId },
          orderBy: { createdAt: 'asc' },
        });
        if (next) {
          await tx.savedLocation.update({ where: { id: next.id }, data: { isDefault: true } });
        }
      }
    });
  }

  // ---------- preferred professions ----------

  async setPreferredProfessions(userId: string, dto: SetPreferredProfessionsDto) {
    const customerId = await this.customerId(userId);
    const ids = dto.professionIds;

    const valid = await this.prisma.profession.count({ where: { id: { in: ids }, active: true } });
    if (valid !== ids.length) {
      throw new AppException(400, ErrorCode.VALIDATION_FAILED, 'Validation failed', {
        professionIds: ['one or more professions do not exist'],
      });
    }

    await this.prisma.$transaction([
      this.prisma.customerPreferredProfession.deleteMany({ where: { customerId } }),
      this.prisma.customerPreferredProfession.createMany({
        data: ids.map((professionId) => ({ customerId, professionId })),
      }),
    ]);

    const items = await this.prisma.profession.findMany({
      where: { id: { in: ids } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, iconUrl: true },
    });
    return { items };
  }
}