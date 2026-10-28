import { describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '../src/lib/api';
import { errorDetails, friendlyError, SOMETHING_WENT_WRONG } from '../src/lib/errors';

// Stand-in error classes, so the Supabase client behind the real api module is not loaded.
vi.mock('../src/lib/api', async () => {
  const { ApiError, NetworkError } = await import('./fakeServer');
  return { ApiError, NetworkError };
});

describe('what the farmer is told when something fails', () => {
  it('never shows technical text from a bug', () => {
    expect(friendlyError(new TypeError('Cannot convert 100 to BigInt'))).toBe(SOMETHING_WENT_WRONG);
    expect(friendlyError('weird', 'Could not save. Try again.')).toBe('Could not save. Try again.');
  });

  it('says changes are kept when there is no connection or the server is unwell', () => {
    expect(friendlyError(new NetworkError('x'))).toMatch(/kept on this phone/);
    expect(friendlyError(new ApiError(503, 'internal_error', 'Something went wrong. Please try again.', {}))).toMatch(/kept on this phone/);
  });

  it('passes on the account’s own plain messages, and explains sign-in and rate limits', () => {
    expect(friendlyError(new ApiError(409, 'insufficient_stock', 'Only 4 L of saleable milk is in stock.', {}))).toBe('Only 4 L of saleable milk is in stock.');
    expect(friendlyError(new ApiError(401, 'unauthorized', 'Session expired.', {}))).toBe('Your sign-in has expired. Sign in again.');
    expect(friendlyError(new ApiError(401, 'signed_out', 'This phone was signed out from another phone.', {}))).toBe('This phone was signed out from another phone.');
    expect(friendlyError(new ApiError(429, 'rate_limited', 'Too many', {}))).toMatch(/Wait a minute/);
  });

  it('keeps the technical detail for the crash screen’s Show details', () => {
    expect(errorDetails(new TypeError('Cannot convert 100 to BigInt'))).toBe('TypeError: Cannot convert 100 to BigInt');
    expect(errorDetails('boom')).toBe('boom');
  });
});
