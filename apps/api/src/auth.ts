import { createLocalJWKSet, createRemoteJWKSet, type JSONWebKeySet, jwtVerify } from 'jose';

export type VerifyToken = (token: string) => Promise<{ authUserId: string }>;

/**
 * Verifies Supabase Auth access tokens against the project's signing keys: the given key set
 * (Edge Functions receive it as SUPABASE_JWKS), or else the project's published JWKS URL.
 */
export function supabaseTokenVerifier(supabaseUrl: string, keys?: JSONWebKeySet): VerifyToken {
  const issuer = `${supabaseUrl.replace(/\/$/, '')}/auth/v1`;
  const jwks = keys ? createLocalJWKSet(keys) : createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: 'authenticated' });
    if (!payload.sub) throw new Error('token has no subject');
    return { authUserId: payload.sub };
  };
}
