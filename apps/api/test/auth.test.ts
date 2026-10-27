import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { supabaseTokenVerifier } from '../src/auth.js';

const URL_ = 'https://xgdhqmlkjfhcfjkmrqrx.supabase.co';
let keys: { keys: object[] };
let sign: (claims: { iss?: string; aud?: string; sub?: string; exp?: string }, key?: CryptoKey) => Promise<string>;
let otherKey: CryptoKey;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  otherKey = (await generateKeyPair('ES256')).privateKey;
  keys = { keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' }] };
  sign = ({ iss = `${URL_}/auth/v1`, aud = 'authenticated', sub = 'user-1', exp = '1h' }, key = privateKey) =>
    new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setIssuer(iss).setAudience(aud).setSubject(sub).setIssuedAt().setExpirationTime(exp).sign(key);
});

// The Edge Function verifies tokens with the project's key set (SUPABASE_JWKS), no network call.
describe('Supabase token verification', () => {
  it('accepts a token signed by the project for an authenticated user', async () => {
    const verify = supabaseTokenVerifier(`${URL_}/`, keys as never);
    await expect(verify(await sign({}))).resolves.toEqual({ authUserId: 'user-1' });
  });

  it.each([
    ['another project', { iss: 'https://other.supabase.co/auth/v1' }],
    ['a non-user audience', { aud: 'anon' }],
    ['an expired token', { exp: '-1m' }],
  ])('rejects %s', async (_, claims) => {
    const verify = supabaseTokenVerifier(URL_, keys as never);
    await expect(verify(await sign(claims))).rejects.toThrow();
  });

  it('rejects a token signed with any other key', async () => {
    const verify = supabaseTokenVerifier(URL_, keys as never);
    await expect(verify(await sign({}, otherKey))).rejects.toThrow();
  });
});
