import { afterAll, beforeAll, expect, it } from 'vitest';
import { pool } from '../src/db.ts';
import { seed } from '../src/seed.ts';
import { resetDb } from './helpers.ts';

beforeAll(resetDb);
afterAll(() => pool.end());

// T21: seed em banco limpo e repetido
it('seed idempotente: 1 leiloeiro, 2 licitantes com saldo, 1 lote ao vivo, sem duplicar', async () => {
  await seed();
  await seed();
  const q = async (sql: string) => (await pool.query(sql)).rows;
  expect(await q(`SELECT role, count(*)::int AS n FROM users GROUP BY role ORDER BY role`))
    .toEqual([{ role: 'AUCTIONEER', n: 1 }, { role: 'BIDDER', n: 2 }]);
  expect(await q(`SELECT w.balance_cents FROM wallets w JOIN users u ON u.id = w.user_id WHERE u.role = 'BIDDER'`))
    .toEqual([{ balance_cents: 500000 }, { balance_cents: 500000 }]);
  expect(await q(`SELECT count(*)::int AS n FROM wallet_entries`)).toEqual([{ n: 2 }]);
  expect(await q(`SELECT count(*)::int AS n FROM lots WHERE starts_at <= now() AND ends_at > now()`)).toEqual([{ n: 1 }]);
  expect((await q(`SELECT octet_length(image_bytes) AS n FROM item_snapshots`))[0].n).toBeGreaterThan(10_000);
});
