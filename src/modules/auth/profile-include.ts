import type { Prisma } from '@prisma/client';

export const profileInclude = {
  customerProfile: { select: { onboardedAt: true } },
  professionalProfile: { select: { onboardedAt: true } },
} satisfies Prisma.UserInclude;

export type UserWithProfiles = Prisma.UserGetPayload<{
  include: typeof profileInclude;
}>;