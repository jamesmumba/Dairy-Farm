import type { FarmerAccount } from '../src/accounts.js';
import type { Db } from '../src/db.js';
import type { Photos } from '../src/photos.js';

export const account = (id: string): FarmerAccount => ({
  id,
  display_name: null,
  preferred_contact: null,
  phone: null,
  farm_name: null,
  farm_location: null,
  time_zone: 'Africa/Lusaka',
  currency: 'ZMW',
  volume_unit: 'L',
  weight_unit: 'kg',
  language: 'en',
  date_format: 'DD/MM/YYYY',
  notification_prefs: {},
  decline_rule: { recent_days: 7, baseline_days: 7, threshold_pct: 20, min_days: 4 },
  breeding_intervals: { pregnancy_check_days: 35, gestation_days: 283 },
  onboarding_step: null,
  onboarding_completed_at: null,
  deletion_requested_at: null,
  version: 1,
  created_at: '2026-10-26T00:00:00Z',
  updated_at: '2026-10-26T00:00:00Z',
});

// Fake token "valid-<user>" maps to auth user <user>; anything else is rejected.
export const verifyToken = async (token: string) => {
  if (!token.startsWith('valid-')) throw new Error('bad token');
  return { authUserId: token.slice(6) };
};

// For tests that never touch farm records.
export const noDb: Db = {
  query: async () => {
    throw new Error('db not used in this test');
  },
  connect: async () => {
    throw new Error('db not used in this test');
  },
};

/** In-memory photo storage: an upload "happens" when the test calls upload(). */
export function fakePhotos() {
  const stored = new Set<string>();
  const removed: string[] = [];
  const photos: Photos = {
    createUploadUrl: async (path) => `https://storage.test/upload/${path}?token=t`,
    exists: async (path) => stored.has(path),
    createDownloadUrl: async (path, secs) => `https://storage.test/sign/${path}?expires=${secs}`,
    remove: async (path) => {
      removed.push(path);
      stored.delete(path);
    },
  };
  return { photos, upload: (path: string) => stored.add(path), removed };
}
