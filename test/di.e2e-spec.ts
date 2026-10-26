import { describe, expect, it } from 'vitest';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';

describe('decorator metadata', () => {
  it('shows what the transformer produced', () => {
    console.log({
      moduleProviders: Reflect.getMetadata('providers', PrismaModule),
      moduleExports: Reflect.getMetadata('exports', PrismaModule),
      isGlobal: Reflect.getMetadata('__module:global__', PrismaModule),
      serviceType: typeof PrismaService,
      authParams: Reflect.getMetadata('design:paramtypes', AuthService)?.map(
        (p: { name?: string } | undefined) => p?.name,
      ),
    });
    expect(true).toBe(true);
  });
});