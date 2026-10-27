import type { Router } from './router.js';
import { z } from 'zod';
import { CARE_ENTITIES, createCare, createSchema, listCare, removeCare, RemoveBody, updateCare, updateSchema } from './care.js';
import type { Db } from './db.js';
import { parse, requireIdempotencyKey, requireVersion, send } from './http.js';
import { idempotent } from './idempotency.js';

const IdParam = z.object({ id: z.uuid() });
const ListQuery = z.object({ cattle_id: z.uuid().optional() }).strict();

/** The same five routes for every care entity: list, create, update, remove. */
export function careRoutes(v1: Router, { db }: { db: Db }) {
  for (const e of CARE_ENTITIES) {
    const create = createSchema(e);
    const update = updateSchema(e);
    const ctx = (req: { farmer: { account: { id: string }; authUserId: string } }) => ({ owner: req.farmer.account.id, actor: req.farmer.authUserId });

    v1.get(`/${e.path}`, async (req) => listCare(db, e, ctx(req).owner, parse(ListQuery, req.query).cattle_id));

    v1.post(`/${e.path}`, async (req, reply) => {
      const { owner, actor } = ctx(req);
      const key = requireIdempotencyKey(req);
      const input = parse(create, req.body);
      return send(
        reply,
        await idempotent(db, owner, key, `${e.table}.create`, input, async (client) => ({
          status: 201,
          body: await createCare({ client, owner, actor }, e, input),
        })),
      );
    });

    v1.patch(`/${e.path}/:id`, async (req, reply) => {
      const { owner, actor } = ctx(req);
      const key = requireIdempotencyKey(req);
      const { id } = parse(IdParam, req.params);
      const version = requireVersion(req);
      const patch = parse(update, req.body);
      return send(
        reply,
        await idempotent(db, owner, key, `${e.table}.update:${id}`, { version, patch }, async (client) => ({
          status: 200,
          body: await updateCare({ client, owner, actor }, e, id, version, patch),
        })),
      );
    });

    v1.post(`/${e.path}/:id/remove`, async (req, reply) => {
      const { owner, actor } = ctx(req);
      const key = requireIdempotencyKey(req);
      const { id } = parse(IdParam, req.params);
      const version = requireVersion(req);
      const { reason } = parse(RemoveBody, req.body);
      return send(
        reply,
        await idempotent(db, owner, key, `${e.table}.remove:${id}`, { version, reason }, async (client) => ({
          status: 200,
          body: await removeCare({ client, owner, actor }, e, id, version, reason),
        })),
      );
    });
  }
}
