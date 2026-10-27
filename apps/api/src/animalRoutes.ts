import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BREED_COLUMNS, BreedCreate, BreedUpdate, createBreed, updateBreed } from './breeds.js';
import {
  CATTLE_COLUMNS,
  CattleCreate,
  CattleUpdate,
  changeStatus,
  createCattle,
  deleteCattle,
  getCattle,
  PhotoConfirm,
  setPhoto,
  StatusChange,
  timeline,
  updateCattle,
} from './cattle.js';
import type { Db } from './db.js';
import { HttpError, parse, requireIdempotencyKey, requireVersion, send } from './http.js';
import { idempotent } from './idempotency.js';
import type { Photos } from './photos.js';
import { pull, PullQuery } from './sync.js';

const IdParam = z.object({ id: z.uuid() });
const PHOTO_URL_SECONDS = 600;

export function animalRoutes(v1: FastifyInstance, { db, photos }: { db: Db; photos: Photos }) {
  const ctx = (req: { farmer: { account: { id: string }; authUserId: string } }) => ({
    owner: req.farmer.account.id,
    actor: req.farmer.authUserId,
  });
  const idParam = (params: unknown) => parse(IdParam, params).id;

  // --- Breeds ---------------------------------------------------------------

  v1.get('/breeds', async (req) => {
    const { rows } = await db.query(`select ${BREED_COLUMNS} from public.cattle_breeds where owner_id = $1 order by name`, [ctx(req).owner]);
    return rows;
  });

  v1.post('/breeds', async (req, reply) => {
    const { owner, actor } = ctx(req);
    const key = requireIdempotencyKey(req);
    const input = parse(BreedCreate, req.body);
    return send(reply, await idempotent(db, owner, key, 'breed.create', input, async (c) => ({ status: 201, body: await createBreed(c, owner, actor, input) })));
  });

  v1.patch('/breeds/:id', async (req, reply) => {
    const { owner, actor } = ctx(req);
    const key = requireIdempotencyKey(req);
    const id = idParam(req.params);
    const version = requireVersion(req);
    const patch = parse(BreedUpdate, req.body);
    return send(
      reply,
      await idempotent(db, owner, key, `breed.update:${id}`, { version, patch }, async (c) => ({
        status: 200,
        body: await updateBreed(c, owner, actor, id, version, patch),
      })),
    );
  });

  // --- Cattle ---------------------------------------------------------------

  v1.get('/cattle', async (req) => {
    const { rows } = await db.query(
      `select ${CATTLE_COLUMNS} from public.cattle where owner_id = $1 and deleted_at is null order by ear_tag nulls last, name`,
      [ctx(req).owner],
    );
    return rows;
  });

  v1.get('/cattle/:id', async (req) => getCattle(db, ctx(req).owner, idParam(req.params)));

  v1.post('/cattle', async (req, reply) => {
    const { owner, actor } = ctx(req);
    const key = requireIdempotencyKey(req);
    const input = parse(CattleCreate, req.body);
    return send(reply, await idempotent(db, owner, key, 'cattle.create', input, async (c) => ({ status: 201, body: await createCattle(c, owner, actor, input) })));
  });

  v1.patch('/cattle/:id', async (req, reply) => {
    const { owner, actor } = ctx(req);
    const key = requireIdempotencyKey(req);
    const id = idParam(req.params);
    const version = requireVersion(req);
    const patch = parse(CattleUpdate, req.body);
    return send(
      reply,
      await idempotent(db, owner, key, `cattle.update:${id}`, { version, patch }, async (c) => ({
        status: 200,
        body: await updateCattle(c, owner, actor, id, version, patch),
      })),
    );
  });

  v1.post('/cattle/:id/status', async (req, reply) => {
    const { owner, actor } = ctx(req);
    const key = requireIdempotencyKey(req);
    const id = idParam(req.params);
    const version = requireVersion(req);
    const change = parse(StatusChange, req.body);
    return send(
      reply,
      await idempotent(db, owner, key, `cattle.status:${id}`, { version, change }, async (c) => ({
        status: 200,
        body: await changeStatus(c, owner, actor, id, version, change),
      })),
    );
  });

  v1.delete('/cattle/:id', async (req, reply) => {
    const { owner, actor } = ctx(req);
    const key = requireIdempotencyKey(req);
    const id = idParam(req.params);
    const version = requireVersion(req);
    return send(
      reply,
      await idempotent(db, owner, key, `cattle.delete:${id}`, { version }, async (c) => ({
        status: 200,
        body: await deleteCattle(c, owner, actor, id, version),
      })),
    );
  });

  v1.get('/cattle/:id/timeline', async (req) => timeline(db, ctx(req).owner, idParam(req.params)));

  // --- Photos: upload URL -> app uploads -> confirm ------------------------

  v1.post('/cattle/:id/photo-upload', async (req) => {
    const { owner } = ctx(req);
    const id = idParam(req.params);
    await getCattle(db, owner, id);
    const path = `${owner}/${id}/${randomUUID()}.jpg`;
    return { path, upload_url: await photos.createUploadUrl(path) };
  });

  v1.post('/cattle/:id/photo', async (req, reply) => {
    const { owner, actor } = ctx(req);
    const key = requireIdempotencyKey(req);
    const id = idParam(req.params);
    const { path } = parse(PhotoConfirm, req.body);
    await getCattle(db, owner, id); // another owner's animal: 404 before anything else
    // Only paths this API issued for this owner and animal are accepted.
    if (!path.startsWith(`${owner}/${id}/`) || path.includes('..')) {
      throw new HttpError(400, 'validation_failed', 'Invalid photo path.', { field: 'path' });
    }
    if (!(await photos.exists(path))) throw new HttpError(400, 'photo_missing', 'The photo upload did not finish. Try again.');
    let previous: string | null = null;
    const result = await idempotent(db, owner, key, `cattle.photo:${id}`, { path }, async (c) => {
      const { row, previousPath } = await setPhoto(c, owner, actor, id, path);
      previous = previousPath;
      return { status: 200, body: row };
    });
    // Best effort: an orphaned old photo is harmless and stays private.
    if (previous && previous !== path) await photos.remove(previous).catch((err) => req.log.warn({ err }, 'old photo not removed'));
    return send(reply, result);
  });

  v1.get('/cattle/:id/photo-url', async (req) => {
    const animal = await getCattle(db, ctx(req).owner, idParam(req.params));
    if (!animal.photo_path) throw new HttpError(404, 'no_photo', 'This animal has no photo.');
    return { url: await photos.createDownloadUrl(animal.photo_path, PHOTO_URL_SECONDS), expires_in: PHOTO_URL_SECONDS };
  });

  // --- Sync -----------------------------------------------------------------

  v1.get('/sync/pull', async (req) => pull(db, ctx(req).owner, parse(PullQuery, req.query)));
}
