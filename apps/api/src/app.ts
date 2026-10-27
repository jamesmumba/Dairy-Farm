import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import type { VerifyToken } from './auth.js';
import type { Accounts, FarmerAccount } from './accounts.js';
import { ProfilePatch } from './profile.js';
import { animalRoutes } from './animalRoutes.js';
import { milkRoutes } from './milkRoutes.js';
import { careRoutes } from './careRoutes.js';
import { financeRoutes } from './financeRoutes.js';
import type { Db } from './db.js';
import { HttpError } from './http.js';
import type { Photos } from './photos.js';

const DeletionRequest = z.object({ reason: z.string().trim().max(500).optional() }).strict();

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  const issue = error.issues[0];
  return reply.status(400).send({ error: 'validation_failed', message: issue.message, field: issue.path.join('.') });
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth hook on every /v1 route. The only source of owner_id. */
    farmer: { authUserId: string; account: FarmerAccount };
  }
}

export interface AppDeps {
  verifyToken: VerifyToken;
  accounts: Accounts;
  db: Db;
  photos: Photos;
  receipts: Photos;
  logLevel?: string;
  /** Behind a hosting proxy (Fly, Render…): use the forwarded client address for rate limits. */
  trustProxy?: boolean;
}

export async function buildApp({ verifyToken, accounts, db, photos, receipts, logLevel = 'info', trustProxy = false }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy,
    // Largest legitimate body is a sale or care record; photos never pass through the API.
    bodyLimit: 256 * 1024,
    logger: {
      level: logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
  });

  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  // Farm and customer data must not be cached by proxies or sniffed as another content type.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
  });

  // Safe errors: clients get a code and message, never stack traces or SQL details.
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    const status = err.statusCode ?? 500;
    if (err instanceof HttpError) {
      return reply.status(status).send({ error: err.code, message: err.message, ...err.extra });
    }
    if (status >= 500) {
      req.log.error(err);
      return reply.status(status).send({ error: 'internal_error', message: 'Something went wrong. Please try again.' });
    }
    return reply.status(status).send({ error: err.code ?? 'bad_request', message: err.message });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(
    async (v1) => {
      v1.decorateRequest('farmer', null as unknown as FastifyRequest['farmer']);

      v1.addHook('onRequest', async (req, reply) => {
        const header = req.headers.authorization;
        const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
        if (!token) return reply.status(401).send({ error: 'unauthorized', message: 'Sign in required.' });

        let authUserId: string;
        try {
          ({ authUserId } = await verifyToken(token));
        } catch {
          return reply.status(401).send({ error: 'unauthorized', message: 'Session expired. Please sign in again.' });
        }
        req.farmer = { authUserId, account: await accounts.getOrCreate(authUserId) };
      });

      v1.get('/me', async (req) => req.farmer.account);

      v1.patch('/me', async (req, reply) => {
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

      v1.post('/me/deletion-request', async (req, reply) => {
        const parsed = DeletionRequest.safeParse(req.body ?? {});
        if (!parsed.success) return sendValidationError(reply, parsed.error);
        return accounts.requestDeletion(req.farmer.account, req.farmer.authUserId, parsed.data.reason ?? null);
      });

      animalRoutes(v1, { db, photos });
      milkRoutes(v1, { db });
      careRoutes(v1, { db });
      financeRoutes(v1, { db, receipts });
    },
    { prefix: '/v1' },
  );

  return app;
}
