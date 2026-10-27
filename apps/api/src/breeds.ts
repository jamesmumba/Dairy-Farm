import { z } from 'zod';
import { audit, type DbClient, isUniqueViolation } from './db.js';
import { HttpError } from './http.js';

export const BreedCreate = z.object({ id: z.uuid(), name: z.string().trim().min(1, 'Enter a breed name').max(60) }).strict();
export const BreedUpdate = z
  .object({ name: z.string().trim().min(1, 'Enter a breed name').max(60).optional(), active: z.boolean().optional() })
  .strict();

export interface Breed {
  id: string;
  name: string;
  active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export const BREED_COLUMNS = 'id, name, active, version, created_at, updated_at';

function nameTaken(err: unknown): never {
  if (isUniqueViolation(err, 'cattle_breeds_owner_name_uq')) {
    throw new HttpError(409, 'breed_exists', 'You already have a breed with this name.', { field: 'name' });
  }
  throw err;
}

export async function createBreed(client: DbClient, ownerId: string, actor: string, input: z.infer<typeof BreedCreate>) {
  const row = await client
    .query<Breed>(`insert into public.cattle_breeds (owner_id, id, name) values ($1, $2, $3) returning ${BREED_COLUMNS}`, [
      ownerId,
      input.id,
      input.name,
    ])
    .then((r) => r.rows[0], nameTaken);
  await audit(client, { ownerId, actorUserId: actor, action: 'breed.created', entityTable: 'cattle_breeds', entityId: row.id, after: row });
  return row;
}

export async function updateBreed(
  client: DbClient,
  ownerId: string,
  actor: string,
  id: string,
  version: number,
  patch: z.infer<typeof BreedUpdate>,
) {
  const { rows } = await client.query<Breed>(
    `select ${BREED_COLUMNS} from public.cattle_breeds where owner_id = $1 and id = $2 for update`,
    [ownerId, id],
  );
  const current = rows[0];
  if (!current) throw new HttpError(404, 'not_found', 'Breed not found.');
  if (current.version !== version) {
    throw new HttpError(409, 'version_conflict', 'This breed was changed elsewhere.', { current });
  }
  const row = await client
    .query<Breed>(
      `update public.cattle_breeds set name = coalesce($3, name), active = coalesce($4, active)
       where owner_id = $1 and id = $2 returning ${BREED_COLUMNS}`,
      [ownerId, id, patch.name ?? null, patch.active ?? null],
    )
    .then((r) => r.rows[0], nameTaken);
  await audit(client, {
    ownerId,
    actorUserId: actor,
    action: 'breed.updated',
    entityTable: 'cattle_breeds',
    entityId: id,
    before: { name: current.name, active: current.active },
    after: { name: row.name, active: row.active },
  });
  return row;
}
