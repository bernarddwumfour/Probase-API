import { describe, expect, it } from 'vitest';
import { validateWorkingDays, WorkingDayInput } from './working-days.util';

const week = (): WorkingDayInput[] =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    dayOfWeek: d,
    isOpen: d !== 0,
    opensAt: d !== 0 ? '08:00' : null,
    closesAt: d !== 0 ? '18:00' : null,
  }));

describe('validateWorkingDays', () => {
  it('accepts a full valid week', () => {
    expect(validateWorkingDays(week())).toEqual({});
  });

  it('requires exactly seven days', () => {
    expect(validateWorkingDays(week().slice(0, 6))).toHaveProperty('workingDays');
  });

  it('rejects a duplicated day', () => {
    const days = week();
    days[3].dayOfWeek = 2;
    expect(validateWorkingDays(days)).toHaveProperty(['workingDays.3.dayOfWeek']);
  });

  it('requires both times when a day is open', () => {
    const days = week();
    days[1] = { dayOfWeek: 1, isOpen: true };
    const errors = validateWorkingDays(days);
    expect(errors).toHaveProperty(['workingDays.1.opensAt']);
    expect(errors).toHaveProperty(['workingDays.1.closesAt']);
  });

  it('requires closing to be later than opening', () => {
    const days = week();
    days[2].closesAt = '08:00';
    expect(validateWorkingDays(days)).toHaveProperty(['workingDays.2.closesAt']);
  });

  it('ignores hours on a closed day', () => {
    const days = week();
    days[0] = { dayOfWeek: 0, isOpen: false, opensAt: '20:00', closesAt: '01:00' };
    expect(validateWorkingDays(days)).toEqual({});
  });
});