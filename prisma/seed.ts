import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const PROFESSIONS = [
  'Plumber',
  'Electrician',
  'AC Technician',
  'Cleaner',
  'Hair Stylist',
  'Private Tutor',
  'Photographer',
  'Appliance Repair',
  'Makeup Artist',
  'Carpenter',
];

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  for (const name of PROFESSIONS) {
    await prisma.profession.upsert({
      where: { slug: slugify(name) },
      update: { name },
      create: { name, slug: slugify(name) },
    });
  }
  console.log(`Seeded ${PROFESSIONS.length} professions`);

  // Optional admin: only when both variables are set. An existing account is left untouched.
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    if (password.length < 12) {
      throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters');
    }
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        fullName: 'ProBase Admin',
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        emailVerifiedAt: new Date(),
        systemRole: 'admin',
      },
    });
    console.log(`Admin ready: ${email}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());