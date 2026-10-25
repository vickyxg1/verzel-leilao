import { readFile } from 'node:fs/promises';
import type pg from 'pg';
import { anchorPool } from './anchor.ts';
import { createUser, type Role } from './auth.ts';
import { pool, tx } from './db.ts';
import { migrate } from './migrate.ts';
import { deposit } from './wallet.ts';

// Contas sintéticas de demonstração (documentadas no README). Não são segredos.
export const DEMO_PASSWORD = 'demo12345';
const DEMO_USERS: { email: string; name: string; role: Role }[] = [
  { email: 'leiloeiro@demo.local', name: 'Leiloeiro Demo', role: 'AUCTIONEER' },
  { email: 'ana@demo.local', name: 'Ana Demo', role: 'BIDDER' },
  { email: 'bruno@demo.local', name: 'Bruno Demo', role: 'BIDDER' },
];
const DEMO_DEPOSIT_CENTS = 500_000; // R$ 5.000,00

async function ensureUser(c: pg.PoolClient, u: (typeof DEMO_USERS)[number]) {
  const found = await c.query('SELECT id FROM users WHERE email = $1', [u.email]);
  return found.rows[0]?.id ?? createUser(c, { ...u, password: DEMO_PASSWORD });
}

// Item embutido no repositório (Art Institute of Chicago, domínio público):
// a demonstração não depende da API externa.
async function insertDemoSnapshot(c: pg.PoolClient) {
  const image = await readFile(new URL('../seed/water-lilies.jpg', import.meta.url));
  const { rows } = await c.query(
    `INSERT INTO item_snapshots (source, external_id, title, attributes, image_bytes, image_mime, source_url)
     VALUES ('AIC', '16568', 'Water Lilies', $1, $2, 'image/jpeg', 'https://www.artic.edu/artworks/16568')
     RETURNING id`,
    [{ artist: 'Claude Monet (French, 1840–1926)', date: '1906', medium: 'Oil on canvas', origin: 'France' }, image],
  );
  return rows[0].id as number;
}

// Idempotente: pode rodar a cada deploy. Garante contas, saldo inicial e ao menos um lote ao vivo.
export async function seed() {
  await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(43)');
    const ids: number[] = [];
    for (const u of DEMO_USERS) ids.push(await ensureUser(c, u));
    for (const [i, u] of DEMO_USERS.entries()) {
      if (u.role === 'BIDDER') await deposit(c, ids[i], DEMO_DEPOSIT_CENTS, `seed-deposit:${u.email}`);
    }

    const live = await c.query(
      `SELECT 1 FROM lots WHERE seller_id = $1 AND cancelled_at IS NULL AND starts_at <= now() AND ends_at > now()`,
      [ids[0]],
    );
    if (!live.rowCount) {
      const snapshotId = await insertDemoSnapshot(c);
      await c.query(
        `INSERT INTO lots (seller_id, item_snapshot_id, starting_price_cents, min_increment_cents, starts_at, ends_at, original_ends_at)
         VALUES ($1, $2, 100000, 5000, now() - interval '5 minutes', now() + interval '3 days', now() + interval '3 days')`,
        [ids[0], snapshotId],
      );
      console.log('seed: lote ao vivo criado');
    }
  });
}

if (import.meta.main) {
  await migrate();
  await seed();
  await Promise.all([pool.end(), anchorPool.end()]);
  console.log('seed concluído');
}
