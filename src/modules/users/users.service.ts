import { Injectable } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import { profileInclude } from '../auth/auth.service';
import { PasswordService } from '../auth/services/password.service';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { toMeResponse } from './user.mapper';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  private async load(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: profileInclude,
    });
    if (!user || user.deletedAt) {
      throw new AppException(401, ErrorCode.UNAUTHORIZED, 'Invalid access token');
    }
    return user;
  }

  async getMe(userId: string) {
    return toMeResponse(await this.load(userId));
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      // undefined fields are left alone; phone: null clears the number
      data: { fullName: dto.fullName, phone: dto.phone, language: dto.language },
      include: profileInclude,
    });
    return toMeResponse(user);
  }

  async setActiveRole(userId: string, role: Role) {
    const user = await this.load(userId);
    const profile = role === 'customer' ? user.customerProfile : user.professionalProfile;

    if (!profile?.onboardedAt) {
      throw new AppException(
        422,
        ErrorCode.ROLE_NOT_ONBOARDED,
        `Complete ${role} onboarding first`,
        { role },
      );
    }
    if (user.activeRole !== role) {
      await this.prisma.user.update({ where: { id: userId }, data: { activeRole: role } });
    }
    return {
      activeRole: role,
      onboarded: {
        customer: !!user.customerProfile?.onboardedAt,
        professional: !!user.professionalProfile?.onboardedAt,
      },
    };
  }

  async deleteAccount(userId: string, dto: DeleteAccountDto) {
    const user = await this.load(userId);

    if (user.passwordHash) {
      const ok =
        !!dto.password && (await this.passwords.verify(user.passwordHash, dto.password));
      if (!ok) {
        throw new AppException(
          400,
          ErrorCode.PASSWORD_INCORRECT,
          'Enter your current password to delete your account',
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          // The email column is unique and required, so use a placeholder.
          // This also frees the real address for a future signup.
          email: `deleted+${userId}@deleted.invalid`,
          fullName: 'Deleted user',
          passwordHash: null,
          phone: null,
          avatarUrl: null,
          activeRole: null,
          deletedAt: new Date(),
        },
      }),
      this.prisma.refreshSession.deleteMany({ where: { userId } }),
      this.prisma.deviceToken.deleteMany({ where: { userId } }),
      this.prisma.authIdentity.deleteMany({ where: { userId } }),
      this.prisma.otpCode.deleteMany({ where: { userId } }),
    ]);
  }
}