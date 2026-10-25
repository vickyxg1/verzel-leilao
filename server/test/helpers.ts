import request from 'supertest';
import { anchorPool } from '../src/anchor.ts';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

export const app = createApp();

export async function resetDb() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await anchorPool.query('DROP TABLE IF EXISTS bid_anchors');
  await migrate();
}

export const closeDb = () => Promise.all([pool.end(), anchorPool.end()]);

// Lote direto no banco, com horários relativos a now() em segundos (permite lote já ao vivo/encerrado).
export async function insertLot(sellerId: number, opts: { startOffsetS?: number; endOffsetS?: number; start?: number; inc?: number } = {}) {
  const { startOffsetS = -60, endOffsetS = 3600, start = 10_000, inc = 1_000 } = opts;
  const snap = await pool.query(
    `INSERT INTO item_snapshots (source, external_id, title, attributes) VALUES ('TEST', '1', 'Obra Teste', '{"artist":"Artista"}') RETURNING id`,
  );
  const { rows } = await pool.query(
    `INSERT INTO lots (seller_id, item_snapshot_id, starting_price_cents, min_increment_cents, starts_at, ends_at, original_ends_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5), now() + make_interval(secs => $6), now() + make_interval(secs => $6))
     RETURNING id`,
    [sellerId, snap.rows[0].id, start, inc, startOffsetS, endOffsetS],
  );
  return rows[0].id as number;
}

// Agente supertest com cookie de sessão já autenticado.
export async function registerAs(role: 'AUCTIONEER' | 'BIDDER', email = `${role.toLowerCase()}-${Math.random()}@t.local`) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send({ email, password: 'senha-forte-1', name: 'Teste', role });
  if (res.status !== 201) throw new Error(`register falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body as { id: number; role: string; alias: string } };
}
