import type { Router } from './router.js';
import { z } from 'zod';
import type { Db } from './db.js';
import { parse, requireIdempotencyKey, requireVersion, send } from './http.js';
import { idempotent } from './idempotency.js';
import { correctMilk, createMilk, listMilk, MilkCorrect, MilkCreate, MilkListQuery, MilkVoid, voidMilk } from './milk.js';

const IdParam = z.object({ id: z.uuid() });

export function milkRoutes(v1: Router, { db }: { db: Db }) {
  const who = (req: { farmer: { account: { id: string }; authUserId: string } }) => ({
    owner: req.farmer.account.id,
    actor: req.farmer.authUserId,
  });

  v1.get('/milk-production', async (req) => listMilk(db, who(req).owner, parse(MilkListQuery, req.query)));

  v1.post('/milk-production', async (req, reply) => {
    const { owner, actor } = who(req);
    const key = requireIdempotencyKey(req);
    const input = parse(MilkCreate, req.body);
    return send(reply, await idempotent(db, owner, key, 'milk.create', input, async (c) => ({ status: 201, body: await createMilk(c, owner, actor, input) })));
  });

  v1.post('/milk-production/:id/correct', async (req, reply) => {
    const { owner, actor } = who(req);
    const key = requireIdempotencyKey(req);
    const { id } = parse(IdParam, req.params);
    const version = requireVersion(req);
    const input = parse(MilkCorrect, req.body);
    return send(
      reply,
      await idempotent(db, owner, key, `milk.correct:${id}`, { version, input }, async (c) => ({
        status: 200,
        body: await correctMilk(c, owner, actor, id, version, input),
      })),
    );
  });

  v1.post('/milk-production/:id/void', async (req, reply) => {
    const { owner, actor } = who(req);
    const key = requireIdempotencyKey(req);
    const { id } = parse(IdParam, req.params);
    const version = requireVersion(req);
    const { reason } = parse(MilkVoid, req.body);
    return send(
      reply,
      await idempotent(db, owner, key, `milk.void:${id}`, { version, reason }, async (c) => ({
        status: 200,
        body: await voidMilk(c, owner, actor, id, version, reason),
      })),
    );
  });
}
