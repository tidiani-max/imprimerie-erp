// Tiny DB adapter so the same SQL runs on:
//   * real PostgreSQL via `pg`           (when DATABASE_URL is set — server/VPS mode)
//   * embedded PostgreSQL via PGlite     (otherwise — desktop / offline mode)
// API: db.query(sql, params) -> rows[] ; db.tx(async (t) => { await t.query(...) }) ; db.close()
import pg from 'pg';
import path from 'node:path';
import fs from 'node:fs';

const toNum = (v) => (v === null ? null : Number(v));
const keepString = (v) => v;

export async function createDb(config) {
  if (config.databaseUrl) return createPg(config);
  return createPglite(config);
}

function createPg(config) {
  // NUMERIC / BIGINT -> JS number, DATE -> 'YYYY-MM-DD' string (no timezone shifting)
  pg.types.setTypeParser(1700, toNum);
  pg.types.setTypeParser(20, toNum);
  pg.types.setTypeParser(1082, keepString);
  // Session time zone as a startup parameter so CURRENT_DATE ("today") follows the shop's local day.
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    options: `-c timezone=${config.timezone.replace(/[^A-Za-z0-9_/+-]/g, '')}`,
  });
  return {
    kind: 'postgres',
    async query(text, params = []) {
      return (await pool.query(text, params)).rows;
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          query: async (t, p = []) => (await client.query(t, p)).rows,
          exec: async (t) => { await client.query(t); },
        });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function createPglite(config) {
  const { PGlite, types } = await import('@electric-sql/pglite');
  fs.mkdirSync(config.pgliteDir, { recursive: true });
  // pg_trgm = fast "contains" search on big tables. Optional: without it everything still works, only slower.
  let extensions = {};
  try { extensions = { pg_trgm: (await import('@electric-sql/pglite/contrib/pg_trgm')).pg_trgm }; } catch { /* not available */ }
  const db = new PGlite(path.resolve(config.pgliteDir), {
    extensions,
    parsers: { [types.NUMERIC]: toNum, [types.INT8]: toNum, [types.DATE]: keepString },
  });
  await db.waitReady;
  await db.exec(`SET TIME ZONE '${config.timezone.replace(/'/g, '')}'`);
  return {
    kind: 'pglite',
    async query(text, params = []) {
      return (await db.query(text, params)).rows;
    },
    async exec(sql) {
      await db.exec(sql);
    },
    async tx(fn) {
      return db.transaction((t) =>
        fn({
          query: async (s, p = []) => (await t.query(s, p)).rows,
          exec: async (s) => { await t.exec(s); },
        }),
      );
    },
    close: () => db.close(),
  };
}
