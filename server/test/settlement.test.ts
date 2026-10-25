import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.ts';
import { app, closeDb, insertLot, registerAs, resetDb } from './helpers.ts';

type Agent = Awaited<ReturnType<typeof registerAs>>;
let seller: Agent;

async function bidderWith(cents: number) {
  const b = await registerAs('BIDDER');
  await b.agent.post('/api/wallet/deposit').send({ amountCents: cents });
  return b;
}
const bid = (b: Agent, lotId: number, amountCents: number) => b.agent.post(`/api/lots/${lotId}/bids`).send({ amountCents });
const wallet = async (a: Agent) => (await a.agent.get('/api/wallet')).body;
// simula a passagem do tempo até o fim do lote
const expire = (lotId: number) => pool.query(`UPDATE lots SET ends_at = now() - interval '1 second' WHERE id = $1`, [lotId]);
const settleDue = async () => (await pool.query('SELECT settle_due_lots() AS n')).rows[0].n as number;

beforeAll(async () => {
  await resetDb();
  seller = await registerAs('AUCTIONEER');
});
afterAll(closeDb);

describe('liquidação', () => {
  it('debita vencedor (saldo e reserva), credita leiloeiro, perdedor intacto, gera comprovante', async () => {
    const lot = await insertLot(seller.user.id, { start: 10_000, inc: 1_000 });
    const a = await bidderWith(50_000);
    const b = await bidderWith(50_000);
    await bid(a, lot, 10_000);
    await bid(b, lot, 12_000);
    const sellerBefore = (await wallet(seller)).balance_cents;
    await expire(lot);
    expect(await settleDue()).toBeGreaterThanOrEqual(1);

    expect(await wallet(b)).toMatchObject({ balance_cents: 38_000, committed_cents: 0, available_cents: 38_000 });
    expect(await wallet(a)).toMatchObject({ balance_cents: 50_000, committed_cents: 0 });
    expect((await wallet(seller)).balance_cents).toBe(sellerBefore + 12_000);

    const mine = await seller.agent.get('/api/lots/mine');
    const row = mine.body.lots.find((l: any) => l.id === lot);
    expect(row).toMatchObject({ status: 'ENDED', final_amount_cents: 12_000, winner_alias: b.user.alias });
    expect(mine.body.total_received_cents).toBeGreaterThanOrEqual(12_000);

    const parts = await b.agent.get('/api/me/participations');
    const won = parts.body.find((p: any) => p.id === lot);
    expect(won).toMatchObject({ won: true, my_best_cents: 12_000 });
    const lost = (await a.agent.get('/api/me/participations')).body.find((p: any) => p.id === lot);
    expect(lost).toMatchObject({ won: false, receipt_token: null });

    // comprovante público por link, sem login, sem dados pessoais
    const receipt = await request(app).get(`/api/receipts/${won.receipt_token}`);
    expect(receipt.status).toBe(200);
    expect(receipt.body).toMatchObject({ amount_cents: 12_000, winner_alias: b.user.alias, lot_id: lot });
    for (const key of ['winner_id', 'seller_id', 'email', 'name']) expect(receipt.body).not.toHaveProperty(key);
    expect(JSON.stringify(receipt.body)).not.toContain('@');
  });

  it('T12: liquidação concorrente/repetida transfere uma única vez', async () => {
    const lot = await insertLot(seller.user.id, { start: 10_000 });
    const b = await bidderWith(50_000);
    await bid(b, lot, 10_000);
    await expire(lot);
    const results = await Promise.all([
      ...Array.from({ length: 5 }, () => pool.query('SELECT settle_lot($1) AS ok', [lot])),
      pool.query('SELECT settle_due_lots()'),
      request(app).get(`/api/lots/${lot}`),
    ]);
    const oks = results.slice(0, 5).filter((r: any) => r.rows[0].ok).length;
    expect(oks).toBeLessThanOrEqual(1);
    expect((await pool.query('SELECT count(*)::int n FROM settlements WHERE lot_id = $1', [lot])).rows[0].n).toBe(1);
    expect((await pool.query('SELECT count(*)::int n FROM wallet_entries WHERE lot_id = $1', [lot])).rows[0].n).toBe(2);
    expect((await wallet(b)).balance_cents).toBe(40_000);
    expect((await pool.query('SELECT settle_lot($1) AS ok', [lot])).rows[0].ok).toBe(false);
  });

  it('T13: lote sem lances encerra sem vencedor nem transferência', async () => {
    const lot = await insertLot(seller.user.id);
    await expire(lot);
    await settleDue();
    const { rows: [st] } = await pool.query('SELECT winner_id, amount_cents FROM settlements WHERE lot_id = $1', [lot]);
    expect(st).toEqual({ winner_id: null, amount_cents: null });
    expect((await pool.query('SELECT count(*)::int n FROM wallet_entries WHERE lot_id = $1', [lot])).rows[0].n).toBe(0);
    const detail = await request(app).get(`/api/lots/${lot}`);
    expect(detail.body).toMatchObject({ status: 'ENDED', winner_alias: null, final_amount_cents: null });
  });

  it('não liquida lote ainda ao vivo nem cancelado', async () => {
    const live = await insertLot(seller.user.id);
    const cancelled = await insertLot(seller.user.id, { endOffsetS: 1 });
    await pool.query(`UPDATE lots SET cancelled_at = now(), ends_at = now() - interval '1 second' WHERE id = $1`, [cancelled]);
    await settleDue();
    expect((await pool.query('SELECT count(*)::int n FROM settlements WHERE lot_id IN ($1, $2)', [live, cancelled])).rows[0].n).toBe(0);
  });

  it('lote vencido é liquidado ao ser consultado (sem depender do agendador)', async () => {
    const lot = await insertLot(seller.user.id, { start: 10_000 });
    const b = await bidderWith(20_000);
    await bid(b, lot, 10_000);
    await expire(lot);
    const res = await request(app).get(`/api/lots/${lot}`);
    expect(res.body).toMatchObject({ status: 'ENDED', final_amount_cents: 10_000 });
    expect(res.body.settled_at).not.toBeNull();
  });

  it('comprovante inexistente ou token inválido → 404/400', async () => {
    expect((await request(app).get(`/api/receipts/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await request(app).get('/api/receipts/123')).status).toBe(400);
  });
});
