import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool, tx } from './db.ts';

const dir = fileURLToPath(new URL('../migrations/', import.meta.url));

// Aplica migrations/*.sql em ordem, uma vez cada. Lock evita duas instâncias migrando juntas.
export async function migrate() {
  await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(42)');
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const applied = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      if (applied.has(file)) continue;
      await c.query(await readFile(dir + file, 'utf8'));
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      console.log(`migration aplicada: ${file}`);
    }
  });
}

if (import.meta.main) {
  await migrate();
  await pool.end();
}
