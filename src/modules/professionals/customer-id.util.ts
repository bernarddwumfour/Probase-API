import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { PrismaService } from '../../prisma/prisma.service';

export async function requireCustomerId(prisma: PrismaService, userId: string): Promise<string> {
  const profile = await prisma.customerProfile.findFirst({
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