import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with argon2id and never returns the plain password', async () => {
    const hash = await service.hash('password123');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('password123');
  });

  it('produces a different hash each time (random salt)', async () => {
    expect(await service.hash('password123')).not.toBe(await service.hash('password123'));
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await service.hash('password123');
    expect(await service.verify(hash, 'password123')).toBe(true);
    expect(await service.verify(hash, 'password124')).toBe(false);
  });

  it('returns false instead of throwing on a malformed hash', async () => {
    expect(await service.verify('not-a-hash', 'password123')).toBe(false);
  });

  it('verifyDummy resolves without throwing', async () => {
    await expect(service.verifyDummy('whatever')).resolves.toBeUndefined();
  });
});