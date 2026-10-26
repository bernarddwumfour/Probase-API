import type { ConfigService } from '@nestjs/config';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../config/env.schema';
import { TokenService } from './token.service';

const SECRET = 'unit-test-secret-unit-test-secret-1234';

function build(secret = SECRET) {
  const values: Record<string, unknown> = { JWT_ACCESS_TTL: '15m', REFRESH_TTL_DAYS: 30 };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService<Env, true>;
  return new TokenService(new JwtService({ secret }), config);
}

describe('TokenService', () => {
  afterEach(() => vi.useRealTimers());

  it('signs an access token that verifies and carries the user id and role', async () => {
    const tokens = build();
    const jwt = await tokens.signAccessToken({ id: 'user-1', activeRole: 'customer' });
    const payload = await tokens.verifyAccessToken(jwt);
    expect(payload.sub).toBe('user-1');
    expect(payload.role).toBe('customer');
  });

  it('rejects a token signed with a different secret', async () => {
    const jwt = await build('another-secret-another-secret-123456').signAccessToken({
      id: 'user-1',
      activeRole: null,
    });
    await expect(build().verifyAccessToken(jwt)).rejects.toThrow();
  });

  it('rejects a tampered token', async () => {
    const tokens = build();
    const jwt = await tokens.signAccessToken({ id: 'user-1', activeRole: null });
    const [h, p, s] = jwt.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), sub: 'user-2' }),
    ).toString('base64url');
    await expect(tokens.verifyAccessToken(`${h}.${forged}.${s}`)).rejects.toThrow();
  });

  it('rejects an expired token with TokenExpiredError', async () => {
    const tokens = build();
    const jwt = await tokens.signAccessToken({ id: 'user-1', activeRole: null });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 16 * 60_000);
    await expect(tokens.verifyAccessToken(jwt)).rejects.toBeInstanceOf(TokenExpiredError);
  });

  it('generates unique, long, URL-safe refresh tokens', () => {
    const tokens = build();
    const a = tokens.generateRefreshToken();
    const b = tokens.generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(60);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashes tokens deterministically without exposing them', () => {
    const tokens = build();
    const hash = tokens.hashToken('abc');
    expect(hash).toBe(tokens.hashToken('abc'));
    expect(hash).toHaveLength(64);
    expect(hash).not.toBe(tokens.hashToken('abd'));
  });

  it('sets the refresh expiry about 30 days ahead', () => {
    const ms = build().refreshExpiry().getTime() - Date.now();
    expect(ms).toBeGreaterThan(29.9 * 86_400_000);
    expect(ms).toBeLessThan(30.1 * 86_400_000);
  });
});