import { z } from 'zod';
import type { Db } from './db.js';
import { HttpError, parse } from './http.js';
import type { Router } from './router.js';

// Phones signed in to the account. Each phone sends its own id and name on every request
// (X-Device-Id, X-Device-Name, X-Device-Platform, X-App-Version); the auth middleware records it with
// `recordDevice`. Requests without X-Device-Id (older app versions, scripts) work as before, untracked.

export interface DeviceHeaders {
  id: string;
  name: string;
  platform: string;
  appVersion: string | null;
}

const Id = z.uuid();

/** Reads the phone's headers; null when there is no valid device id. The name is URI-encoded (any language). */
export function readDevice(header: (name: string) => string | undefined): DeviceHeaders | null {
  const id = Id.safeParse(header('x-device-id'));
  if (!id.success) return null;
  let name = '';
  try {
    name = decodeURIComponent(header('x-device-name') ?? '').trim();
  } catch {
    // Badly encoded: fall back to a plain name.
  }
  const platform = header('x-device-platform') ?? '';
  return {
    id: id.data,
    name: name.slice(0, 60) || 'Phone',
    platform: ['android', 'ios', 'web'].includes(platform) ? platform : 'other',
    appVersion: header('x-app-version')?.slice(0, 20) || null,
  };
}

/** How often a busy phone's "last seen" is written: once a minute is plenty. */
const SEEN_EVERY_SECONDS = 60;

/**
 * Notes that this phone used the account. 'signed_out' when another phone signed it out and it is still
 * on the same sign-in; signing in again starts a new session and lets it back in.
 */
export async function recordDevice(db: Db, owner: string, sessionId: string | undefined, d: DeviceHeaders): Promise<'ok' | 'signed_out'> {
  const session = sessionId ?? null;
  const { rows } = await db.query(
    `select name, platform, app_version, session_id, signed_out_at,
            last_seen > now() - make_interval(secs => $3) as fresh
     from public.devices where owner_id = $1 and device_id = $2`,
    [owner, d.id, SEEN_EVERY_SECONDS],
  );
  const row = rows[0];
  if (row?.signed_out_at && row.session_id === session) return 'signed_out';
  const unchanged = row && !row.signed_out_at && row.name === d.name && row.platform === d.platform && row.app_version === d.appVersion && row.session_id === session;
  if (unchanged && row.fresh) return 'ok';
  await db.query(
    `insert into public.devices (owner_id, device_id, name, platform, app_version, session_id)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (owner_id, device_id) do update
       set name = excluded.name, platform = excluded.platform, app_version = excluded.app_version,
           session_id = excluded.session_id, last_seen = now(), signed_out_at = null`,
    [owner, d.id, d.name, d.platform, d.appVersion, session],
  );
  return 'ok';
}

export function deviceRoutes(v1: Router, { db }: { db: Db }) {
  v1.get('/devices', async (req) => {
    const { rows } = await db.query(
      `select device_id, name, platform, app_version, first_seen, last_seen from public.devices
       where owner_id = $1 and signed_out_at is null order by last_seen desc limit 50`,
      [req.farmer.account.id],
    );
    return rows.map((r) => ({ ...r, this_device: r.device_id === req.farmer.deviceId }));
  });

  v1.post('/devices/:id/sign-out', async (req) => {
    const id = parse(Id, req.params.id);
    if (id === req.farmer.deviceId) throw new HttpError(400, 'this_device', 'To sign out this phone, use Sign out.');
    const { rows } = await db.query(
      `update public.devices set signed_out_at = now()
       where owner_id = $1 and device_id = $2 and signed_out_at is null returning session_id`,
      [req.farmer.account.id, id],
    );
    if (!rows.length) throw new HttpError(404, 'not_found', 'That phone is not signed in.');
    await endSessions(db, req.farmer.authUserId, { only: rows.map((r) => r.session_id).filter(Boolean) }, req.log);
    return { signed_out: 1 };
  });

  // This phone is signing itself out: take it off the list. The app ends its own sign-in afterwards.
  v1.post('/devices/sign-out-this', async (req) => {
    const { deviceId } = req.farmer;
    if (!deviceId) return { signed_out: 0 };
    const { rows } = await db.query(
      `update public.devices set signed_out_at = now()
       where owner_id = $1 and device_id = $2 and signed_out_at is null returning device_id`,
      [req.farmer.account.id, deviceId],
    );
    return { signed_out: rows.length };
  });

  // Every phone but this one, including any that never reported a device id.
  v1.post('/devices/sign-out-others', async (req) => {
    const { deviceId, sessionId } = req.farmer;
    if (!deviceId || !sessionId) throw new HttpError(400, 'device_required', 'Update the app to sign out other phones.');
    const { rows } = await db.query(
      `update public.devices set signed_out_at = now()
       where owner_id = $1 and device_id <> $2 and signed_out_at is null returning device_id`,
      [req.farmer.account.id, deviceId],
    );
    await endSessions(db, req.farmer.authUserId, { except: sessionId }, req.log);
    return { signed_out: rows.length };
  });
}

/**
 * Ends Supabase Auth sessions so their refresh tokens stop working (refresh tokens go with the session).
 * Best effort: even if this fails, the signed-out mark above already refuses those phones' requests.
 */
async function endSessions(db: Db, authUserId: string, which: { only: string[] } | { except: string }, log: { warn(...a: unknown[]): void }) {
  try {
    if ('only' in which) {
      if (!which.only.length) return;
      await db.query(`delete from auth.sessions where user_id = $1 and id::text = any($2::text[])`, [authUserId, which.only]);
    } else {
      await db.query(`delete from auth.sessions where user_id = $1 and id::text <> $2`, [authUserId, which.except]);
    }
  } catch (err) {
    log.warn('could not end auth sessions', err);
  }
}
