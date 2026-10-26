import type { UserWithProfiles } from '../auth/auth.service';

export function toMeResponse(user: UserWithProfiles) {
  return {
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      language: user.language,
      emailVerified: user.emailVerifiedAt !== null,
      createdAt: user.createdAt,
    },
    activeRole: user.activeRole,
    onboarded: {
      customer: !!user.customerProfile?.onboardedAt,
      professional: !!user.professionalProfile?.onboardedAt,
    },
    // Summaries only for now; the onboarding milestone adds business details
    profiles: {
      customer: user.customerProfile,
      professional: user.professionalProfile,
    },
  };
}