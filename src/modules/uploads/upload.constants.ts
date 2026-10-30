import type { UploadPurpose } from '@prisma/client';

const MB = 1024 * 1024;
const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];

export const UPLOAD_RULES: Record<UploadPurpose, { types: readonly string[]; maxBytes: number }> = {
  avatar: { types: IMAGES, maxBytes: 5 * MB },
  portfolio: { types: IMAGES, maxBytes: 8 * MB },
  verification: { types: [...IMAGES, 'application/pdf'], maxBytes: 10 * MB },
};

export const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export const ALL_CONTENT_TYPES = Object.keys(EXTENSIONS);
export const MAX_UPLOAD_BYTES = 10 * MB;

export const URL_TTL_SECONDS = 10 * 60; // time allowed to upload
export const CONSUME_WINDOW_MS = 60 * 60 * 1000; // time allowed to attach it

/** Verification documents are private; everything else is public. */
export const isPrivateKey = (key: string) => key.startsWith('verification/');