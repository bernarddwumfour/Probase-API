import type { RateUnit, Service } from '@prisma/client';

export type ClientRateUnit = 'hr' | 'job' | 'day';

const TO_DB: Record<ClientRateUnit, RateUnit> = { hr: 'hour', job: 'job', day: 'day' };
const TO_CLIENT: Record<RateUnit, ClientRateUnit> = { hour: 'hr', job: 'job', day: 'day' };

export const toRateUnit = (unit: ClientRateUnit): RateUnit => TO_DB[unit];

export function toServiceResponse(s: Service) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    rate: Number(s.rate),
    unit: TO_CLIENT[s.rateUnit],
    currency: s.currency,
  };
}