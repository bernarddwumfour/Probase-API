import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/modules/auth/services/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';

export class FakeMailService {
  verification = new Map<string, string>();
  reset = new Map<string, string>();

  async sendVerificationCode(to: string, _name: string, code: string) {
    this.verification.set(to, code);
  }
  async sendPasswordResetCode(to: string, _name: string, code: string) {
    this.reset.set(to, code);
  }
}

export interface TestCtx {
  app: INestApplication;
  prisma: PrismaService;
  mail: FakeMailService;
  api: () => ReturnType<typeof request>;
  reset: () => Promise<void>;
}

export async function createTestApp(): Promise<TestCtx> {
  const mail = new FakeMailService();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(mail)
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  return {
    app,
    prisma,
    mail,
    api: () => request(app.getHttpServer()),
    reset: async () => {
      // CASCADE clears every table that references users
      await prisma.$executeRawUnsafe('TRUNCATE TABLE "users" CASCADE');
      mail.verification.clear();
      mail.reset.clear();
    },
  };
}

export interface AuthBody {
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  user: { id: string };
  activeRole: string | null;
  onboarded: { customer: boolean; professional: boolean };
}

let counter = 0;

/** Signs up and verifies a user, returning the tokens from verify-otp. */
export async function registerUser(
  ctx: TestCtx,
  opts: { email?: string; password?: string; fullName?: string } = {},
): Promise<AuthBody> {
  const email = opts.email ?? `user${++counter}@example.com`;
  const password = opts.password ?? 'password123';
  await ctx
    .api()
    .post('/v1/auth/signup')
    .send({ fullName: opts.fullName ?? 'Test User', email, password })
    .expect(201);
  const code = ctx.mail.verification.get(email)!;
  const res = await ctx.api().post('/v1/auth/verify-otp').send({ email, code }).expect(200);
  return { email, password, ...res.body };
}


export async function seedProfessions(
  ctx: TestCtx,
  names = ['Plumber', 'Electrician', 'Cleaner'],
) {
  return Promise.all(
    names.map((name) =>
      ctx.prisma.profession.upsert({
        where: { slug: name.toLowerCase() },
        update: { active: true },
        create: { name, slug: name.toLowerCase() },
      }),
    ),
  );
}

export async function onboardCustomer(
  ctx: TestCtx,
  user: AuthBody,
  professionIds: string[],
  locations: object[] = [],
) {
  await ctx
    .api()
    .post('/v1/me/customer-profile')
    .set(bearer(user.accessToken))
    .send({ preferredProfessionIds: professionIds, locations })
    .expect(201);
}

/** One entry per day; Sunday closed, the rest 08:00-18:00. Override single days by index. */
export const workingWeek = (overrides: Record<number, object> = {}) =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    dayOfWeek: d,
    isOpen: d !== 0,
    ...(d !== 0 ? { opensAt: '08:00', closesAt: '18:00' } : {}),
    ...overrides[d],
  }));

export const proBody = (professionId: string, extra: object = {}) => ({
  businessName: 'Kofi Plumbing',
  professionId,
  latitude: 5.6037,
  longitude: -0.187,
  workingDays: workingWeek(),
  ...extra,
});


export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });