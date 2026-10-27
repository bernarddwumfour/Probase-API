export interface WorkingDayInput {
  dayOfWeek: number;
  isOpen: boolean;
  opensAt?: string | null;
  closesAt?: string | null;
}

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** Returns field errors keyed by path; an empty object means valid. */
export function validateWorkingDays(
  days: WorkingDayInput[],
  field = 'workingDays',
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  const add = (path: string, msg: string) => (errors[path] ??= []).push(msg);

  if (days.length !== 7) {
    add(field, 'must contain exactly 7 days, one for each day of the week');
  }

  const seen = new Set<number>();
  days.forEach((d, i) => {
    if (seen.has(d.dayOfWeek)) add(`${field}.${i}.dayOfWeek`, 'duplicate day');
    seen.add(d.dayOfWeek);

    if (!d.isOpen) return; // hours on a closed day are ignored
    if (!d.opensAt) add(`${field}.${i}.opensAt`, 'required when the day is open');
    if (!d.closesAt) add(`${field}.${i}.closesAt`, 'required when the day is open');
    if (d.opensAt && d.closesAt && toMinutes(d.closesAt) <= toMinutes(d.opensAt)) {
      add(`${field}.${i}.closesAt`, 'must be later than opensAt');
    }
  });
  return errors;
}