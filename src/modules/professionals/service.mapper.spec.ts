import { Prisma, Service } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { toRateUnit, toServiceResponse } from './service.mapper';

const row = (rateUnit: Service['rateUnit']): Service => ({
  id: 's1',
  professionalId: 'p1',
  name: 'Pipe Replacement',
  description: null,
  rate: new Prisma.Decimal('12.50'),
  rateUnit,
  currency: 'GHS',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('service mapper', () => {
  it('maps client units to stored units', () => {
    expect(toRateUnit('hr')).toBe('hour');
    expect(toRateUnit('job')).toBe('job');
    expect(toRateUnit('day')).toBe('day');
  });

  it('returns the unit the client expects and the rate as a number', () => {
    expect(toServiceResponse(row('hour'))).toEqual({
      id: 's1',
      name: 'Pipe Replacement',
      description: null,
      rate: 12.5,
      unit: 'hr',
      currency: 'GHS',
    });
  });

  it('passes job and day through unchanged', () => {
    expect(toServiceResponse(row('job')).unit).toBe('job');
    expect(toServiceResponse(row('day')).unit).toBe('day');
  });
});