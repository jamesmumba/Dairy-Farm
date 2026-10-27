import { DatabaseSync } from 'node:sqlite';

// One database per test run; kept on globalThis so it survives vi.resetModules() ("app restart").
const g = globalThis as { __sqlite?: DatabaseSync };
export const resetDatabase = () => (g.__sqlite = new DatabaseSync(':memory:'));

const flat = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? params[0] : params) as (string | number | null)[];

export function openDatabaseSync() {
  const raw = () => (g.__sqlite ??= new DatabaseSync(':memory:'));
  return {
    execSync: (sql: string) => raw().exec(sql),
    runSync: (sql: string, ...params: unknown[]) => raw().prepare(sql).run(...flat(params)),
    getFirstSync: (sql: string, ...params: unknown[]) => raw().prepare(sql).get(...flat(params)) ?? null,
    getAllSync: (sql: string, ...params: unknown[]) => raw().prepare(sql).all(...flat(params)),
    withTransactionSync: (fn: () => void) => {
      raw().exec('begin');
      try {
        fn();
        raw().exec('commit');
      } catch (err) {
        raw().exec('rollback');
        throw err;
      }
    },
  };
}
