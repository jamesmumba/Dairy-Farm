import { z } from 'zod';

/** Optional text: trimmed, and '' becomes null. */
export const text = (max: number) =>
  z.string().trim().max(max).transform((s) => (s === '' ? null : s)).nullable().optional();

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((d) => !Number.isNaN(Date.parse(d)), 'Invalid date');

// Business dates may not be in the future. One day of slack covers time zones ahead of UTC.
export const pastDate = isoDate.refine((d) => Date.parse(d) <= Date.now() + 86_400_000, 'Date cannot be in the future');

/** Decimal as a string with up to 2 decimals, e.g. "12.5". Never a binary float. */
export const decimal = (intDigits: number) =>
  z.string().regex(new RegExp(`^\\d{1,${intDigits}}(\\.\\d{1,2})?$`), 'Enter a number with up to 2 decimals');

/** A reason the farmer must give for a correction or void. */
export const reason = z.string().trim().min(3, 'Say why (at least 3 characters)').max(500);
