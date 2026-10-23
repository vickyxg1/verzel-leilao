import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bidHash, GENESIS_HASH } from '../src/audit.ts';
import { pool } from '../src/db.ts';
import { app, insertLot, registerAs, resetDb } from './helpers.ts';

type Agent = Awaited<ReturnType<typeof registerAs>>;
let seller: Agent;

async function bidderWith(cents: number) {
  const b = await registerAs('BIDDER');
  if (cents) expect((await b.agent.post('/api/wallet/deposit').send({ amountCents: cents })).status).toBe(201);
  return b;
}
const bid = (b: Agent, lotId: number, amountCents: number) => b.agent.post(`/api/lots/${lotId}/bids`).send({ amountCents });
const wallet = async (b: Agent) => (await b.agent.get('/api/wallet')).body;

// Invariante global: reserva de cada carteira = soma dos lances que ela lidera; nunca negativo.
async function assertCommitmentsConsistent() {
  const { rows } = await pool.query(`
    SELECT w.user_id, w.balance_cents, w.committed_cents,
           COALESCE((SELECT sum(current_bid_cents) FROM lots WHERE leader_id = w.user_id), 0)::bigint AS leading
    FROM wallets w`);
  for (const r of rows) {
    expect(r.committed_cents).toBe(r.leading);
    expect(r.committed_cents).toBeLessThanOrEqual(r.balance_cents);
    expect(r.committed_cents).toBeGreaterThanOrEqual(0);
  }
}

beforeAll(async () => {
  await resetDb();
  seller = await registerAs('AUCTIONEER');
});
afterAll(() => pool.end());

describe('carteira', () => {
  it('depósito soma ao saldo; disponível = total - comprometido', async () => {
    const b = await bidderWith(50_000);
    expect(await wallet(b)).toMatchObject({ balance_cents: 50_000, committed_cents: 0, available_cents: 50_000 });
  });

  it('mesma chave de idempotência não deposita duas vezes', async () => {
    const b = await bidderWith(0);
    const key = crypto.randomUUID();
    await Promise.all([1, 2, 3].map(() => b.agent.post('/api/wallet/deposit').send({ amountCents: 1_000, idempotencyKey: key })));
    expect((await wallet(b)).balance_cents).toBe(1_000);
  });

  it('leiloeiro não deposita; valor inválido → 400', async () => {
    expect((await seller.agent.post('/api/wallet/deposit').send({ amountCents: 100 })).status).toBe(403);
    const b = await bidderWith(0);
    expect((await b.agent.post('/api/wallet/deposit').send({ amountCents: -5 })).status).toBe(400);
    expect((await b.agent.post('/api/wallet/deposit').send({ amountCents: 10.5 })).status).toBe(400);
  });
});

describe('regras de lance', () => {
  it('T01: leiloeiro não dá lance (403) e nada é gravado', async () => {
    const lot = await insertLot(seller.user.id);
    expect((await bid(seller, lot, 50_000)).status).toBe(403);
    expect((await pool.query('SELECT count(*)::int n FROM bids WHERE lot_id = $1', [lot])).rows[0].n).toBe(0);
  });

  it('anônimo não dá lance (401)', async () => {
    const lot = await insertLot(seller.user.id);
    expect((await request(app).post(`/api/lots/${lot}/bids`).send({ amountCents: 10_000 })).status).toBe(401);
  });

  it('T03: primeiro lance abaixo do inicial rejeita; igual aceita', async () => {
    const lot = await insertLot(seller.user.id, { start: 10_000, inc: 1_000 });
    const b = await bidderWith(100_000);
    const low = await bid(b, lot, 9_999);
    expect(low.status).toBe(422);
    expect(low.body.code).toBe('BID_TOO_LOW');
    expect(low.body.message).toContain('100,00');
    expect((await bid(b, lot, 10_000)).status).toBe(201);
  });

  it('T04: lance seguinte abaixo de atual+incremento rejeita; igual aceita', async () => {
    const lot = await insertLot(seller.user.id, { start: 10_000, inc: 1_000 });
    const a = await bidderWith(100_000);
    const b = await bidderWith(100_000);
    expect((await bid(a, lot, 10_000)).status).toBe(201);
    expect((await bid(b, lot, 10_999)).body.code).toBe('BID_TOO_LOW');
    expect((await bid(b, lot, 11_000)).status).toBe(201);
  });

  it('T05: líder não cobre o próprio lance; reserva não muda', async () => {
    const lot = await insertLot(seller.user.id);
    const a = await bidderWith(100_000);
    await bid(a, lot, 10_000);
    const res = await bid(a, lot, 20_000);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_LEADING');
    expect((await wallet(a)).committed_cents).toBe(10_000);
  });

  it('T06: antes do início, após o fim e em lote cancelado → rejeita com motivo', async () => {
    const b = await bidderWith(100_000);
    const scheduled = await insertLot(seller.user.id, { startOffsetS: 600, endOffsetS: 1200 });
    expect((await bid(b, scheduled, 10_000)).body.code).toBe('LOT_NOT_STARTED');
    const justEnded = await insertLot(seller.user.id, { startOffsetS: -600, endOffsetS: -0.5 });
    expect((await bid(b, justEnded, 10_000)).body.code).toBe('LOT_ENDED');
    const cancelled = await insertLot(seller.user.id);
    await pool.query('UPDATE lots SET cancelled_at = now() WHERE id = $1', [cancelled]);
    expect((await bid(b, cancelled, 10_000)).body.code).toBe('LOT_CANCELLED');
    expect((await bid(b, 999_999, 10_000)).status).toBe(404);
    expect((await wallet(b)).committed_cents).toBe(0);
  });

  it('T07: saldo insuficiente rejeita e não compromete', async () => {
    const lot = await insertLot(seller.user.id);
    const b = await bidderWith(9_000);
    const res = await bid(b, lot, 10_000);
    expect(res.body.code).toBe('INSUFFICIENT_FUNDS');
    expect(await wallet(b)).toMatchObject({ committed_cents: 0, available_cents: 9_000 });
  });

  it('T08: superado tem reserva liberada na mesma transação', async () => {
    const lot = await insertLot(seller.user.id, { start: 10_000, inc: 1_000 });
    const a = await bidderWith(50_000);
    const b = await bidderWith(50_000);
    await bid(a, lot, 10_000);
    expect(await wallet(a)).toMatchObject({ committed_cents: 10_000, available_cents: 40_000 });
    await bid(b, lot, 15_000);
    expect(await wallet(a)).toMatchObject({ committed_cents: 0, available_cents: 50_000 });
    expect(await wallet(b)).toMatchObject({ committed_cents: 15_000, available_cents: 35_000 });
    await assertCommitmentsConsistent();
  });

  it('reserva soma entre lotes: disponível limita lance em outro lote', async () => {
    const l1 = await insertLot(seller.user.id, { start: 30_000 });
    const l2 = await insertLot(seller.user.id, { start: 30_000 });
    const a = await bidderWith(50_000);
    expect((await bid(a, l1, 30_000)).status).toBe(201);
    expect((await bid(a, l2, 30_000)).body.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('histórico público só tem pseudônimo e forma cadeia de hashes válida', async () => {
    const lot = await insertLot(seller.user.id, { start: 1_000, inc: 100 });
    const a = await bidderWith(50_000);
    const b = await bidderWith(50_000);
    await bid(a, lot, 1_000);
    await bid(b, lot, 1_100);
    await bid(a, lot, 1_500);
    const res = await request(app).get(`/api/lots/${lot}/bids`);
    const history = res.body.reverse();
    expect(history.map((h: any) => h.seq)).toEqual([1, 2, 3]);
    expect(JSON.stringify(res.body)).not.toMatch(/@|bidder_id|email/);
    let prev = GENESIS_HASH;
    for (const h of history) {
      expect(h.prev_hash).toBe(prev);
      expect(bidHash({ lot_id: lot, ...h })).toBe(h.hash);
      prev = h.hash;
    }
  });
});

describe('anti-sniping', () => {
  it('T10: lance com <= 120 s restantes estende o fim em +120 s', async () => {
    const lot = await insertLot(seller.user.id, { endOffsetS: 100 });
    const before = (await pool.query('SELECT ends_at FROM lots WHERE id = $1', [lot])).rows[0].ends_at;
    const b = await bidderWith(50_000);
    const res = await bid(b, lot, 10_000);
    expect(res.body.extended).toBe(true);
    const after = (await pool.query('SELECT ends_at FROM lots WHERE id = $1', [lot])).rows[0].ends_at;
    expect(after.getTime() - before.getTime()).toBe(120_000);
  });

  it('T11: lance com > 120 s restantes não prorroga', async () => {
    const lot = await insertLot(seller.user.id, { endOffsetS: 200 });
    const before = (await pool.query('SELECT ends_at FROM lots WHERE id = $1', [lot])).rows[0].ends_at;
    const b = await bidderWith(50_000);
    expect((await bid(b, lot, 10_000)).body.extended).toBe(false);
    expect((await pool.query('SELECT ends_at FROM lots WHERE id = $1', [lot])).rows[0].ends_at).toEqual(before);
  });
});

describe('concorrência (T09)', () => {
  it('muitos lances simultâneos no mesmo lote: estado serializável e reservas consistentes', async () => {
    const lot = await insertLot(seller.user.id, { start: 10_000, inc: 1_000 });
    const bidders = await Promise.all([1, 2, 3, 4].map(() => bidderWith(1_000_000)));
    // 20 lances disparados ao mesmo tempo, vários com o mesmo valor
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => bid(bidders[i % 4], lot, 10_000 + Math.floor(i / 2) * 1_000)),
    );
    const accepted = results.filter((r) => r.status === 201);
    for (const r of results) expect([201, 409, 422]).toContain(r.status);
    const { rows: [l] } = await pool.query('SELECT bid_count, current_bid_cents FROM lots WHERE id = $1', [lot]);
    expect(l.bid_count).toBe(accepted.length);
    const { rows: history } = await pool.query('SELECT seq, amount_cents FROM bids WHERE lot_id = $1 ORDER BY seq', [lot]);
    expect(history.map((h) => h.seq)).toEqual(history.map((_, i) => i + 1));
    for (let i = 1; i < history.length; i++) {
      expect(history[i].amount_cents).toBeGreaterThanOrEqual(history[i - 1].amount_cents + 1_000);
    }
    expect(l.current_bid_cents).toBe(history.at(-1)!.amount_cents);
    await assertCommitmentsConsistent();
  });

  it('mesmo licitante, dois lotes, saldo para só um: só um lance passa', async () => {
    const l1 = await insertLot(seller.user.id, { start: 10_000 });
    const l2 = await insertLot(seller.user.id, { start: 10_000 });
    const b = await bidderWith(15_000);
    const [r1, r2] = await Promise.all([bid(b, l1, 10_000), bid(b, l2, 10_000)]);
    expect([r1.status, r2.status].sort()).toEqual([201, 422]);
    expect(await wallet(b)).toMatchObject({ committed_cents: 10_000, available_cents: 5_000 });
    await assertCommitmentsConsistent();
  });
});
