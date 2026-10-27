# ProBase API

Backend for ProBase, a mobile marketplace that connects customers with local service professionals (electricians, plumbers, cleaners, stylists and similar). Built with NestJS, PostgreSQL and Prisma.

This repository currently covers authentication, account management and role onboarding. Search, bookings, messaging, notifications and reviews come next (see [Roadmap](#roadmap)).

## Stack

- **NestJS 11** (TypeScript, strict mode), REST under the `/v1` prefix
- **PostgreSQL** with **Prisma 6**
- **JWT** access tokens plus rotating opaque refresh tokens
- **argon2id** password hashing
- **class-validator** DTOs, **zod** environment validation
- **pino** structured logging with request ids
- **Swagger** docs (development only) at `/docs`
- **Vitest** with SWC for unit and e2e tests

## Requirements

- Node.js 22 (`.nvmrc` is included, so `nvm use` works)
- PostgreSQL 16 running locally
- npm

## Setup

### 1. Install

```bash
npm install
```

### 2. Create the databases

Open `psql` as an admin user (for example `sudo -u postgres psql`) and run:

```sql
CREATE USER probase WITH PASSWORD 'probase' CREATEDB;
CREATE DATABASE probase OWNER probase;
CREATE DATABASE probase_test OWNER probase;
```

`CREATEDB` is required. Prisma Migrate creates a temporary shadow database during development.

### 3. Configure the environment

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Paste the generated value into `JWT_ACCESS_SECRET` in `.env`. The app refuses to start if the secret is short or still the placeholder.

### 4. Migrate and seed

```bash
npx prisma migrate dev
npm run db:seed
```

The seed adds the 10 professions. It is safe to run repeatedly. To also create an admin account, set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` (at least 12 characters) before running it.

### 5. Run

```bash
npm run start:dev
```

- API: `http://localhost:3000/v1`
- Swagger UI: `http://localhost:3000/docs` (development only)
- Health: `GET /v1/health` (liveness) and `GET /v1/health/ready` (checks the database)

In development, `MAIL_TRANSPORT=console` prints verification and reset codes in the terminal instead of sending email. Look for `[mail:console]`.

## Scripts

| Script | What it does |
|---|---|
| `npm run start:dev` | Start with file watching |
| `npm run build` | Compile to `dist/` |
| `npm test` | Unit tests (no database needed) |
| `npm run test:e2e` | End-to-end tests against `probase_test` |
| `npm run test:db:migrate` | Apply migrations to `probase_test` |
| `npm run db:seed` | Seed professions (and the optional admin) |
| `npm run prisma:migrate` | Create and apply a migration in development |
| `npm run prisma:deploy` | Apply existing migrations (production) |
| `npm run prisma:generate` | Regenerate the Prisma client |
| `npm run prisma:studio` | Browse the database |

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `PORT` | `3000` | |
| `CORS_ORIGINS` | empty | Comma-separated browser origins. Native apps ignore CORS |
| `DATABASE_URL` | none | PostgreSQL connection string (required) |
| `JWT_ACCESS_SECRET` | none | At least 32 characters (required) |
| `JWT_ACCESS_TTL` | `15m` | Access token lifetime |
| `REFRESH_TTL_DAYS` | `30` | Refresh token lifetime |
| `OTP_TTL_MINUTES` | `10` | One-time code lifetime |
| `OTP_MAX_ATTEMPTS` | `5` | Wrong guesses allowed per code |
| `OTP_RESEND_COOLDOWN_SECONDS` | `60` | Minimum gap between codes |
| `MAIL_TRANSPORT` | `console` | `console` or `smtp`. `console` is rejected in production |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | | Required when `MAIL_TRANSPORT=smtp` |
| `MAIL_FROM` | `ProBase <no-reply@probase.local>` | |
| `GOOGLE_CLIENT_IDS` | empty | For social login, not yet implemented |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | unset | Optional, used only by `npm run db:seed` |
| `TEST_DATABASE_URL` | `probase_test` on localhost | Must end in `_test` or the e2e tests refuse to run |

## Project structure

```
prisma/
  schema.prisma            Database models
  migrations/              SQL history of every schema change
  seed.ts                  Professions and optional admin
src/
  main.ts                  Bootstrap: helmet, CORS, Swagger, logger
  app.setup.ts             Prefix, validation pipe and error filter (shared with tests)
  app.module.ts            Root module
  config/                  Environment validation (zod)
  prisma/                  PrismaService and module
  common/                  errors, filters, pipes, decorators, guards, logging
  modules/
    health/                /health, /health/ready
    auth/                  signup, OTP, login, tokens, passwords
    users/                 /me, role switching, account deletion
    professions/           GET /professions
    customers/             customer onboarding, locations, preferred professions
    professionals/         professional onboarding
test/                      e2e tests and helpers
```

## API overview

All routes are under `/v1`. Everything needs `Authorization: Bearer <accessToken>` except the public auth routes. The full request and response shapes are in the integration guide for the mobile team.

| Area | Endpoints |
|---|---|
| Auth (public) | `POST /auth/signup`, `/auth/verify-otp`, `/auth/resend-otp`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password` |
| Auth (token) | `POST /auth/change-password` |
| Account | `GET /me`, `PATCH /me`, `PUT /me/active-role`, `DELETE /me` |
| Lookups | `GET /professions` |
| Onboarding | `POST /me/customer-profile`, `POST /me/professional-profile` |
| Customer settings | `GET`, `POST /me/locations`, `PATCH`, `DELETE /me/locations/:id`, `PUT /me/preferred-professions` |
| Health | `GET /health`, `GET /health/ready` |

### Error format

Every error has the same shape. Clients should branch on `code`, never on `message`.

```json
{ "statusCode": 400, "code": "VALIDATION_FAILED", "message": "Validation failed", "details": { "email": ["email must be an email"] } }
```

For `VALIDATION_FAILED`, `details` is keyed by field path, such as `locations.0.latitude`.

### Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Invalid input. See `details` |
| `UNAUTHORIZED` | 401 | Missing or invalid access token |
| `TOKEN_EXPIRED` | 401 | Access token expired. Refresh and retry |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `REFRESH_INVALID` | 401 | Refresh token unknown, expired or revoked |
| `REFRESH_REUSED` | 401 | A rotated refresh token was replayed. The whole session is revoked |
| `FORBIDDEN` | 403 | Not allowed |
| `EMAIL_NOT_VERIFIED` | 403 | Verify the email first |
| `ACCOUNT_SUSPENDED` | 403 | Account is blocked |
| `NOT_FOUND` | 404 | Resource not found, or not yours |
| `EMAIL_TAKEN` | 409 | Email is already registered |
| `ALREADY_ONBOARDED` | 409 | That role's onboarding is already complete |
| `OTP_INVALID` | 400 | Wrong verification code |
| `OTP_EXPIRED` | 400 | Code expired |
| `OTP_ATTEMPTS_EXCEEDED` | 429 | Too many wrong attempts. Request a new code |
| `OTP_RESEND_TOO_SOON` | 429 | Resend cooldown not over |
| `RESET_CODE_INVALID` | 400 | Reset code wrong, expired or already used |
| `OLD_PASSWORD_INCORRECT` | 400 | Current password is wrong |
| `PASSWORD_UNCHANGED` | 400 | New password equals the old one |
| `PASSWORD_INCORRECT` | 400 | Wrong password when deleting the account |
| `PASSWORD_NOT_SET` | 422 | Social-only account has no password yet |
| `ROLE_NOT_ONBOARDED` | 422 / 403 | 422 when switching to an unfinished role, 403 on role-only routes |
| `LOCATION_LIMIT_REACHED` | 422 | Customer already has 5 saved locations |
| `RATE_LIMITED` | 429 | Too many requests. See the `Retry-After` header |
| `INTERNAL_ERROR` | 500 | Unexpected error. The details are in the server log |
| `SERVICE_UNAVAILABLE` | 503 | A dependency (the database) is down |

## Security notes

- Passwords are hashed with argon2id. Login takes the same time for unknown emails, and the responses do not reveal which emails exist.
- Refresh tokens are random, stored only as SHA-256 hashes, rotated on every use, and grouped in families. Replaying an old token revokes the whole family.
- One-time codes are stored as an HMAC bound to the user and purpose, expire after 10 minutes, and lock after 5 wrong attempts.
- The auth guard checks the database on every request, so suspended or deleted users lose access immediately. The role in the token is only a hint.
- Rate limits are per IP and per route. Counters are in memory, which is fine for one instance. Move them to Redis before running several.
- Request bodies and the `Authorization` header are never logged.
- Account deletion is a soft delete: personal data and sessions are removed, and the email is freed for a new signup.

## Testing

```bash
npm test                 # unit tests
npm run test:e2e         # needs probase_test migrated: npm run test:db:migrate
```

The e2e tests use a separate `probase_test` database and refuse to run against any database whose name does not end in `_test`. Mail is replaced by an in-memory fake, and rate limiting is off when `NODE_ENV=test`.

## Roadmap

Done: authentication, account management, role switching, customer and professional onboarding, customer locations and preferred professions.

Next:

- File uploads (avatars, portfolio, verification documents)
- Professional search and profiles, saved professionals
- Bookings with a status state machine, notifications
- Messaging (REST and WebSocket)
- Professional dashboard and `/pro/*` management endpoints
- Reviews, support tickets, push notifications
- Google and Facebook sign-in (the `AuthIdentity` table is ready)