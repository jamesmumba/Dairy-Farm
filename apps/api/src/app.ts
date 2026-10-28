import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { VerifyToken } from './auth.js';
import type { Accounts } from './accounts.js';
import { ProfilePatch } from './profile.js';
import { animalRoutes } from './animalRoutes.js';
import { milkRoutes } from './milkRoutes.js';
import { careRoutes } from './careRoutes.js';
import { financeRoutes } from './financeRoutes.js';
import { notificationRoutes } from './notificationRoutes.js';
import type { Db } from './db.js';
import { HttpError } from './http.js';
import type { Photos } from './photos.js';
import { type ApiEnv, BadJson, type Reply, router } from './router.js';

const DeletionRequest = z.object({ reason: z.string().trim().max(500).optional() }).strict();

function sendValidationError(reply: Reply, error: z.ZodError) {
  const issue = error.issues[0];
  return reply.status(400).send({ error: 'validation_failed', message: issue.message, field: issue.path.join('.') });
}

export interface AppDeps {
  verifyToken: VerifyToken;
  accounts: Accounts;
  db: Db;
  photos: Photos;
  receipts: Photos;
  /** Behind a proxy (Supabase Edge, Fly, Render…): use the forwarded client address for rate limits. */
  trustProxy?: boolean;
  /** Requests per minute per client address. */
  rateLimitPerMinute?: number;
}

/** Fixed-window, per-address request limit. In memory, so it applies per server instance. */
function rateLimiter(max: number, trustProxy: boolean) {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return async (c: Context<ApiEnv>, next: () => Promise<void>) => {
    const forwarded = trustProxy ? c.req.header('x-forwarded-for')?.split(',')[0].trim() : undefined;
    const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
    const key = forwarded || incoming?.socket?.remoteAddress || 'local';
    const now = Date.now();
    let w = windows.get(key);
    if (!w || w.resetAt <= now) {
      if (windows.size > 10_000) windows.clear(); // bound memory
      w = { count: 0, resetAt: now + 60_000 };
      windows.set(key, w);
    }
    if (++w.count > max) {
      c.header('Retry-After', String(Math.ceil((w.resetAt - now) / 1000)));
      return c.json({ error: 'rate_limited', message: 'Too many requests. Wait a minute and try again.' }, 429);
    }
    await next();
  };
}

export async function buildApp({ verifyToken, accounts, db, photos, receipts, trustProxy = false, rateLimitPerMinute = 300 }: AppDeps) {
  const app = new Hono<ApiEnv>();

  // Farm and customer data must not be cached by proxies or sniffed as another content type.
  app.use('*', async (c, next) => {
    await next();
    c.res.headers.set('Cache-Control', 'no-store');
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Referrer-Policy', 'no-referrer');
  });
  app.use('*', rateLimiter(rateLimitPerMinute, trustProxy));
  // Largest legitimate body is a sale or care record; photos never pass through the API.
  app.use('*', bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: 'payload_too_large', message: 'Request too large.' }, 413) }));

  // Safe errors: clients get a code and message, never stack traces or SQL details.
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code, message: err.message, ...err.extra }, err.statusCode as 400);
    if (err instanceof BadJson) return c.json({ error: 'bad_request', message: err.message }, 400);
    console.error(err);
    return c.json({ error: 'internal_error', message: 'Something went wrong. Please try again.' }, 500);
  });
  app.notFound((c) => c.json({ error: 'not_found', message: 'Not found.' }, 404));

  app.get('/health', (c) => c.json({ status: 'ok' }));
  /** Readiness: the API can reach the database (deploy checks and monitoring). */
  app.get('/health/ready', async (c) => {
    await db.query('select 1');
    return c.json({ status: 'ok', database: 'ok' });
  });
  /**
   * Where Supabase's sign-up confirmation link lands once the address is confirmed. Plain text on purpose:
   * Supabase serves function responses as text, and the farmer only needs to know to go back to the app.
   */
  app.get('/email-confirmed', (c) =>
    c.text('Your email is confirmed.\n\nGo back to the Dairy Farm app and tap "I\'ve confirmed my email" (or sign in).\n'),
  );

  const v1 = new Hono<ApiEnv>();
  v1.use('*', async (c, next) => {
    const header = c.req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) return c.json({ error: 'unauthorized', message: 'Sign in required.' }, 401);
    let authUserId: string;
    try {
      ({ authUserId } = await verifyToken(token));
    } catch {
      return c.json({ error: 'unauthorized', message: 'Session expired. Please sign in again.' }, 401);
    }
    c.set('farmer', { authUserId, account: await accounts.getOrCreate(authUserId) });
    await next();
  });
  const r = router(v1);

  r.get('/me', async (req) => req.farmer.account);

  r.patch('/me', async (req, reply) => {
    const expectedVersion = Number(req.headers['if-match']);
    if (!Number.isInteger(expectedVersion)) {
      return reply.status(428).send({ error: 'version_required', message: 'If-Match header with the record version is required.' });
    }
    const parsed = ProfilePatch.safeParse(req.body ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const { account } = req.farmer;
    const contact = parsed.data.preferred_contact ?? account.preferred_contact;
    const phone = parsed.data.phone === undefined ? account.phone : parsed.data.phone;
    if (contact === 'phone' && !phone) {
      return reply.status(400).send({ error: 'validation_failed', message: 'Add a phone number to use phone as your contact.', field: 'phone' });
    }

    const result = await accounts.update(account, req.farmer.authUserId, expectedVersion, parsed.data);
    if (!result.ok) {
      return reply.status(409).send({
        error: 'version_conflict',
        message: 'Your profile was changed elsewhere. Review the latest version.',
        current: result.current,
      });
    }
    return result.account;
  });

  r.post('/me/deletion-request', async (req, reply) => {
    const parsed = DeletionRequest.safeParse(req.body ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    return accounts.requestDeletion(req.farmer.account, req.farmer.authUserId, parsed.data.reason ?? null);
  });

  animalRoutes(r, { db, photos });
  milkRoutes(r, { db });
  careRoutes(r, { db });
  financeRoutes(r, { db, receipts });
  notificationRoutes(r, { db });

  app.route('/v1', v1);
  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
