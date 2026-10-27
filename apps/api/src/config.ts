import { z } from 'zod';

const Env = z.object({
  // Direct/pooler Postgres connection for the backend only. Never shipped to the app.
  DATABASE_URL: z.string().url(),
  // e.g. https://<ref>.supabase.co — used to verify access tokens via JWKS.
  SUPABASE_URL: z.string().url(),
  // Secret (service) key, server only: signs private photo upload/download URLs.
  SUPABASE_SECRET_KEY: z.string().min(20),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Env.parse(env);
}
