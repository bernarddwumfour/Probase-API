import { z } from 'zod';

const csv = (v: string) =>
    v.split(',').map((s) => s.trim()).filter(Boolean);

export const envSchema = z
    .object({
        NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
        PORT: z.coerce.number().int().positive().default(3000),
        CORS_ORIGINS: z.string().default('').transform(csv),

        DATABASE_URL: z.string().startsWith('postgres'),

        JWT_ACCESS_SECRET: z
            .string()
            .min(32, 'must be at least 32 characters')
            .refine((v) => !v.startsWith('change-me'), 'replace the placeholder secret'),
        JWT_ACCESS_TTL: z.string().default('15m'),
        REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

        OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
        OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
        OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(60),

        MAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.coerce.number().int().positive().default(587),
        SMTP_USER: z.string().optional(),
        SMTP_PASS: z.string().optional(),
        MAIL_FROM: z.string().default('ProBase <no-reply@probase.local>'),

        GOOGLE_CLIENT_IDS: z.string().default('').transform(csv),

        
        STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
        STORAGE_LOCAL_DIR: z.string().default('./storage'),
        PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
        S3_ENDPOINT: z.string().url().optional(),
        S3_REGION: z.string().default('us-east-1'),
        S3_ACCESS_KEY_ID: z.string().optional(),
        S3_SECRET_ACCESS_KEY: z.string().optional(),
        S3_PUBLIC_BUCKET: z.string().optional(),
        S3_PRIVATE_BUCKET: z.string().optional(),
        S3_PUBLIC_BASE_URL: z.string().url().optional(),
    })
    .superRefine((env, ctx) => {
        if (env.MAIL_TRANSPORT === 'smtp' && !env.SMTP_HOST) {
            ctx.addIssue({
                code: 'custom',
                path: ['SMTP_HOST'],
                message: 'required when MAIL_TRANSPORT=smtp',
            });
        }
        if (env.NODE_ENV === 'production' && env.MAIL_TRANSPORT === 'console') {
            ctx.addIssue({
                code: 'custom',
                path: ['MAIL_TRANSPORT'],
                message: 'console transport is not allowed in production',
            });
        }
    });

export type Env = z.output<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
    // Treat empty values like "SMTP_HOST=" as not set
    const cleaned = Object.fromEntries(
        Object.entries(raw).filter(([, v]) => v !== ''),
    );
    const result = envSchema.safeParse(cleaned);
    if (!result.success) {
        const issues = result.error.issues
            .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
            .join('\n');
        throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    return result.data;
}