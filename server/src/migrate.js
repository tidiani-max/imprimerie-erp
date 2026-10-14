import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db');

// Version 1 = db/schema.sql. Later changes: add db/migrations/002_*.sql, 003_*.sql ...
export async function migrate(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`);
  const applied = new Set((await db.query('SELECT version FROM schema_migrations')).map((r) => r.version));

  const steps = [{ version: 1, file: path.join(dbDir, 'schema.sql') }];
  const migDir = path.join(dbDir, 'migrations');
  if (fs.existsSync(migDir)) {
    for (const f of fs.readdirSync(migDir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()) {
      steps.push({ version: parseInt(f, 10), file: path.join(migDir, f) });
    }
  }
  for (const step of steps) {
    if (applied.has(step.version)) continue;
    await db.tx(async (t) => {
      await t.exec(fs.readFileSync(step.file, 'utf8'));
      await t.query('INSERT INTO schema_migrations (version) VALUES ($1)', [step.version]);
    });
  }
}
