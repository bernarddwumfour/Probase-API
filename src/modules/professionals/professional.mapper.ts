import type { Prisma } from '@prisma/client';

export const professionalInclude = {
  user: { select: { fullName: true, avatarUrl: true, phone: true } },
  profession: { select: { id: true, name: true } },
} satisfies Prisma.ProfessionalProfileInclude;

export type ProfessionalRow = Prisma.ProfessionalProfileGetPayload<{
  include: typeof professionalInclude;
}>;

/** Which professionals a customer may see. */
export const visibleProfessionalWhere = (viewerUserId: string): Prisma.ProfessionalProfileWhereInput => ({
  onboardedAt: { not: null },
  userId: { not: viewerUserId },
  user: { status: 'active', deletedAt: null },
});

export function toProfessionalCard(
  p: ProfessionalRow,
  opts: { distanceKm?: number | null; isSaved?: boolean } = {},
) {
  const distanceKm = opts.distanceKm == null ? null : Math.round(opts.distanceKm * 100) / 100;
  return {
    id: p.id,
    name: p.businessName,
    ownerName: p.user.fullName,
    profession: p.profession.name,
    professionId: p.profession.id,
    rating: Number(p.ratingAverage),
    ratingCount: p.ratingCount,
    joined: p.createdAt.getUTCFullYear(),
    verified: p.verificationStatus === 'approved',
    online: false, // presence arrives with the messaging gateway
    phone: p.user.phone,
    description: p.description,
    avatar: p.user.avatarUrl,
    latitude: p.latitude,
    longitude: p.longitude,
    operationalRadiusKm: p.operationalRadiusKm,
    distanceKm,
    inServiceArea: distanceKm === null ? null : distanceKm <= p.operationalRadiusKm,
    isSaved: opts.isSaved ?? false,
  };
}