import { config } from '../config';
import { deviceHeaders } from './device';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body: Record<string, unknown>,
  ) {
    super(message);
  }
}

let signedOutElsewhere = false;

/** True once after another phone signed this one out (the sign-in screen explains why). */
export function takeSignedOutElsewhere() {
  const was = signedOutElsewhere;
  signedOutElsewhere = false;
  return was;
}

/** The request never reached the server (offline, timeout, DNS). Safe to retry later. */
export class NetworkError extends Error {}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  ifMatch?: number;
  idempotencyKey?: string;
  timeoutMs?: number;
}

export async function api<T>(path: string, { method = 'GET', body, ifMatch, idempotencyKey, timeoutMs = 15000 }: Options = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, 'unauthorized', 'Sign in required.', {});

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...deviceHeaders(),
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(ifMatch !== undefined && { 'If-Match': String(ifMatch) }),
        ...(idempotencyKey && { 'Idempotency-Key': idempotencyKey }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError('Can’t connect right now. Your changes are kept on this phone.');
  } finally {
    clearTimeout(timer);
  }

  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && json.error === 'signed_out') {
    // Another phone on the account signed this one out: leave the account here too.
    signedOutElsewhere = true;
    void supabase.auth.signOut({ scope: 'local' });
  }
  if (!res.ok) throw new ApiError(res.status, json.error ?? 'error', json.message ?? 'Request failed.', json);
  return json as T;
}
