import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { OnboardCustomerDto } from './dto/onboard-customer.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async onboard(userId: string, dto: OnboardCustomerDto) {
    const ids = dto.preferredProfessionIds;
    const valid = await this.prisma.profession.count({
      where: { id: { in: ids }, active: true },
    });
    if (valid !== ids.length) {
      throw new AppException(400, ErrorCode.VALIDATION_FAILED, 'Validation failed', {
        preferredProfessionIds: ['one or more professions do not exist'],
      });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.customerProfile.findUnique({ where: { userId } });
        if (existing?.onboardedAt) throw this.alreadyOnboarded();

        // A leftover stub without onboardedAt is completed rather than duplicated
        const now = new Date();
        const profile = existing
          ? await tx.customerProfile.update({ where: { id: existing.id }, data: { onboardedAt: now } })
          : await tx.customerProfile.create({ data: { userId, onboardedAt: now } });

        await tx.customerPreferredProfession.createMany({
          data: ids.map((professionId) => ({ customerId: profile.id, professionId })),
        });

        if (dto.locations?.length) {
          await tx.savedLocation.createMany({
            data: dto.locations.map((l, i) => ({
              customerId: profile.id,
              name: l.name,
              latitude: l.latitude,
              longitude: l.longitude,
              address: l.address,
              searchRadiusKm: l.searchRadiusKm ?? 2,
              isDefault: i === 0,
            })),
          });
        }

        await tx.user.update({ where: { id: userId }, data: { activeRole: 'customer' } });
      });
    } catch (err) {
      // Two simultaneous submissions: the unique constraints pick one winner
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw this.alreadyOnboarded();
      }
      throw err;
    }

    return this.users.getMe(userId);
  }

  private alreadyOnboarded() {
    return new AppException(
      409,
      ErrorCode.ALREADY_ONBOARDED,
      'Customer onboarding is already complete',
    );
  }
}