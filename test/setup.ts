import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url =
  process.env.TEST_DATABASE_URL ??
  'postgresql://probase:probase@localhost:5432/probase_test?schema=public';

// Safety net: these tests truncate tables
if (!/\/[^/?]*_test(\?|$)/.test(url)) {
  throw new Error('Refusing to run e2e tests: database name must end in "_test"');
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: url,
  JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-123456',
  JWT_ACCESS_TTL: '15m',
  OTP_RESEND_COOLDOWN_SECONDS: '0',
  OTP_MAX_ATTEMPTS: '5',
  MAIL_TRANSPORT: 'console',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: join(tmpdir(), 'probase-test-storage'),
  PUBLIC_BASE_URL: 'http://localhost:3000',
});