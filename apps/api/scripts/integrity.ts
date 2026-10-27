// Runs the cross-table integrity checks against the database in DATABASE_URL.
//   npm run integrity
// Exit code 1 when any error-level check finds a problem (warnings are reported only).

import pg from 'pg';
import { loadConfig } from '../src/config.js';
import { runIntegrityChecks } from '../src/integrity.js';

const pool = new pg.Pool({ connectionString: loadConfig().DATABASE_URL });
const results = await runIntegrityChecks(pool);
let errors = 0;
for (const r of results) {
  const ok = r.problems.length === 0;
  if (!ok && r.severity === 'error') errors++;
  console.log(`${ok ? 'PASS' : r.severity === 'error' ? 'FAIL' : 'WARN'}  ${r.name}${ok ? '' : ` (${r.problems.length})`}`);
  for (const p of r.problems.slice(0, 20)) console.log('      ', JSON.stringify(p));
}
await pool.end();
process.exitCode = errors ? 1 : 0;
