import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { OnboardProfessionalDto } from './dto/onboard-professional.dto';
import { toRateUnit } from './service.mapper';
import { validateWorkingDays } from './working-days.util';

@Injectable()
export class ProfessionalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async onboard(userId: string, dto: OnboardProfessionalDto) {
    const errors = validateWorkingDays(dto.workingDays);
    const profession = await this.prisma.profession.findFirst({
      where: { id: dto.professionId, active: true },
      select: { id: true },
    });
    if (!profession) errors.professionId = ['profession does not exist'];
    if (Object.keys(errors).length) {
      throw new AppException(400, ErrorCode.VALIDATION_FAILED, 'Validation failed', errors);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.professionalProfile.findUnique({
          where: { userId },
          select: { id: true },
        });
        if (existing) throw this.alreadyOnboarded();

        await tx.professionalProfile.create({
          data: {
            userId,
            businessName: dto.businessName,
            professionId: dto.professionId,
            description: dto.description,
            latitude: dto.latitude,
            longitude: dto.longitude,
            address: dto.address,
            operationalRadiusKm: dto.operationalRadiusKm ?? 5,
            onboardedAt: new Date(),
            workingDays: {
              create: dto.workingDays.map((d) => ({
                dayOfWeek: d.dayOfWeek,
                isOpen: d.isOpen,
                // Hours on a closed day are discarded
                opensAt: d.isOpen ? (d.opensAt ?? null) : null,
                closesAt: d.isOpen ? (d.closesAt ?? null) : null,
              })),
            },
            services: {
              create: (dto.services ?? []).map((s) => ({
                name: s.name,
                description: s.description,
                rate: s.rate,
                rateUnit: toRateUnit(s.unit),
              })),
            },
          },
        });

        await tx.user.update({ where: { id: userId }, data: { activeRole: 'professional' } });
      });
    } catch (err) {
      // Two simultaneous submissions: the unique constraint on userId picks one winner
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
      'Professional onboarding is already complete',
    );
  }
}