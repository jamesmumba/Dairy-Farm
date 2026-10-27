import { type AppDeps, buildApp } from '../src/app.js';

export interface InjectOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  payload?: object | string;
  headers?: Record<string, string>;
}

export interface Injected {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  json(): any;
}

/** The app with an in-process request helper (no network), for tests. */
export async function testApp(deps: AppDeps) {
  // Tests make many requests from one "client"; the rate limit has its own test.
  const app = await buildApp({ rateLimitPerMinute: 1_000_000, ...deps });
  return Object.assign(app, {
    async inject({ method = 'GET', url, payload, headers = {} }: InjectOptions): Promise<Injected> {
      const hasBody = payload !== undefined;
      const res = await app.request(url, {
        method,
        headers: { ...(hasBody && typeof payload === 'object' && { 'content-type': 'application/json' }), ...headers },
        body: hasBody ? (typeof payload === 'string' ? payload : JSON.stringify(payload)) : undefined,
      });
      const body = await res.text();
      return {
        statusCode: res.status,
        body,
        headers: Object.fromEntries(res.headers),
        json: () => JSON.parse(body),
      };
    },
  });
}

export type TestApp = Awaited<ReturnType<typeof testApp>>;
