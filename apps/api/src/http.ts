import type { Reply, Req } from './router.js';
import type { z } from 'zod';

/** A client-facing error: `{ error: code, message, ...extra }` with this status. */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value ?? {});
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new HttpError(400, 'validation_failed', issue.message, { field: issue.path.join('.') });
}

export function requireVersion(req: Pick<Req, 'headers'>): number {
  const version = Number(req.headers['if-match']);
  if (!Number.isInteger(version)) {
    throw new HttpError(428, 'version_required', 'If-Match header with the record version is required.');
  }
  return version;
}

export function requireIdempotencyKey(req: Pick<Req, 'headers'>): string {
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || !/^[0-9a-f-]{36}$/i.test(key)) {
    throw new HttpError(428, 'idempotency_key_required', 'Idempotency-Key header (UUID) is required.');
  }
  return key;
}

export function send(reply: Reply, result: { status: number; body: unknown }) {
  return reply.status(result.status).send(result.body);
}
