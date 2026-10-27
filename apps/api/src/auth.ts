import { createRemoteJWKSet, jwtVerify } from 'jose';

export type VerifyToken = (token: string) => Promise<{ authUserId: string }>;

/** Verifies Supabase Auth access tokens against the project's published signing keys. */
export function supabaseTokenVerifier(supabaseUrl: string): VerifyToken {
  const issuer = `${supabaseUrl}/auth/v1`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: 'authenticated' });
    if (!payload.sub) throw new Error('token has no subject');
    return { authUserId: payload.sub };
  };
}
