import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anchorPool } from '../src/anchor.ts';
import { bidHash, GENESIS_HASH } from '../src/audit.ts';
import { pool } from '../src/db.ts';
import { app, closeDb, insertLot, registerAs, resetDb } from './helpers.ts';

type Agent = Awaited<ReturnType<typeof registerAs>>;
let seller: Agent;
let a: Agent;
let b: Agent;

const audit = async (lotId: number) => (await request(app).get(`/api/lots/${lotId}/audit`)).body;

// Lote com 3 lances reais pela API (ancorados): a 10.000, b 11.000, a 12.000
async function lotWithBids() {
  const lot = await insertLot(seller.user.id, { start: 10_000, inc: 1_000 });
  for (const [who, amount] of [[a, 10_000], [b, 11_000], [a, 12_000]] as const) {
    const res = await who.agent.post(`/api/lots/${lot}/bids`).send({ amountCents: amount });
    expect(res.body.anchored).toBe(true);
  }
  return lot;
}

// Atacante com acesso total ao banco PRINCIPAL: reescreve a cadeia inteira e o lote
// para que tudo fique internamente consistente. Só a âncora externa pode denunciar.
async function attackerRechain(lotId: number) {
  const { rows } = await pool.query(
    `SELECT b.id, b.seq, b.bidder_id, u.public_alias AS bidder_alias, b.amount_cents, b.created_at
     FROM bids b JOIN users u ON u.id = b.bidder_id WHERE b.lot_id = $1 ORDER BY b.seq`,
    [lotId],
  );
  let prev = GENESIS_HASH;
  for (const r of rows) {
    const hash = bidHash({ lot_id: lotId, seq: r.seq, bidder_alias: r.bidder_alias, amount_cents: r.amount_cents, created_at: r.created_at, prev_hash: prev });
    await pool.query('UPDATE bids SET prev_hash = $2, hash = $3 WHERE id = $1', [r.id, prev, hash]);
    prev = hash;
  }
  const last = rows.at(-1);
  await pool.query(
    'UPDATE lots SET bid_count = $2, last_hash = $3, current_bid_cents = $4, leader_id = $5 WHERE id = $1',
    [lotId, rows.length, prev, last?.amount_cents ?? null, last?.bidder_id ?? null],
  );
}

beforeAll(async () => {
  await resetDb();
  seller = await registerAs('AUCTIONEER');
  a = await registerAs('BIDDER');
  b = await registerAs('BIDDER');
  for (const u of [a, b]) await u.agent.post('/api/wallet/deposit').send({ amountCents: 1_000_000 });
});
afterAll(closeDb);

describe('auditoria pública', () => {
  it('histórico intacto → INTEGRO, sem login e sem dados pessoais', async () => {
    const lot = await lotWithBids();
    const res = await request(app).get(`/api/lots/${lot}/audit`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('INTEGRO');
    expect(res.body.issues).toEqual([]);
    expect(res.body.bids).toHaveLength(3);
    expect(res.body.bids.every((x: any) => x.anchored)).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/@|bidder_id|email/);
  });

  it('T14: UPDATE direto no valor de um lance → ADULTERADO', async () => {
    const lot = await lotWithBids();
    await pool.query('UPDATE bids SET amount_cents = 10_500 WHERE lot_id = $1 AND seq = 2', [lot]);
    const r = await audit(lot);
    expect(r.status).toBe('ADULTERADO');
    expect(r.issues.map((i: any) => i.message).join()).toContain('#2');
  });

  it('T14b: UPDATE + reescrita completa dos hashes e do lote → âncora denuncia', async () => {
    const lot = await lotWithBids();
    await pool.query('UPDATE bids SET amount_cents = 10_500 WHERE lot_id = $1 AND seq = 2', [lot]);
    await attackerRechain(lot);
    const r = await audit(lot);
    expect(r.status).toBe('ADULTERADO');
    expect(r.issues.some((i: any) => i.message.includes('âncora'))).toBe(true);
  });

  it('T15: DELETE de lance do meio → ADULTERADO', async () => {
    const lot = await lotWithBids();
    await pool.query('DELETE FROM bids WHERE lot_id = $1 AND seq = 2', [lot]);
    expect((await audit(lot)).status).toBe('ADULTERADO');
  });

  it('T15b: DELETE do último lance com lote e cadeia "consertados" → âncora denuncia', async () => {
    const lot = await lotWithBids();
    await pool.query('DELETE FROM bids WHERE lot_id = $1 AND seq = 3', [lot]);
    await attackerRechain(lot);
    const r = await audit(lot);
    expect(r.status).toBe('ADULTERADO');
    expect(r.issues.some((i: any) => i.message.includes('#3') && i.message.includes('remoção'))).toBe(true);
  });

  it('T16: INSERT retroativo entre lances, com cadeia recalculada → ADULTERADO', async () => {
    const lot = await lotWithBids();
    // abre espaço: seq 2→3, 3→4 (de trás para frente por causa do UNIQUE) e insere um lance falso como #2
    await pool.query('UPDATE bids SET seq = seq + 10 WHERE lot_id = $1 AND seq >= 2', [lot]);
    await pool.query('UPDATE bids SET seq = seq - 9 WHERE lot_id = $1 AND seq >= 12', [lot]);
    await pool.query(
      `INSERT INTO bids (lot_id, seq, bidder_id, amount_cents, created_at, prev_hash, hash)
       SELECT $1, 2, $2, 10_800, created_at + interval '1 millisecond', '', '' FROM bids WHERE lot_id = $1 AND seq = 1`,
      [lot, b.user.id],
    );
    await attackerRechain(lot);
    expect((await audit(lot)).status).toBe('ADULTERADO');
  });

  it('T16b: INSERT de lance falso no fim, cadeia válida → não é dado como íntegro', async () => {
    const lot = await lotWithBids();
    await pool.query(
      `INSERT INTO bids (lot_id, seq, bidder_id, amount_cents, created_at, prev_hash, hash)
       VALUES ($1, 4, $2, 50_000, date_trunc('milliseconds', now()), '', '')`,
      [lot, b.user.id],
    );
    await attackerRechain(lot);
    const r = await audit(lot);
    expect(r.status).not.toBe('INTEGRO');
    expect(r.issues.some((i: any) => i.seq === 4 && i.message.includes('não consta na âncora'))).toBe(true);
  });

  it('comprovante adulterado (valor liquidado alterado) → ADULTERADO', async () => {
    const lot = await lotWithBids();
    await pool.query(`UPDATE lots SET ends_at = now() - interval '1 second' WHERE id = $1`, [lot]);
    await pool.query('SELECT settle_lot($1)', [lot]);
    expect((await audit(lot)).status).toBe('INTEGRO');
    await pool.query('UPDATE settlements SET amount_cents = 1 WHERE lot_id = $1', [lot]);
    expect((await audit(lot)).status).toBe('ADULTERADO');
  });

  it('âncora é somente inserção (UPDATE/DELETE bloqueados no banco da âncora)', async () => {
    const lot = await lotWithBids();
    await expect(anchorPool.query('UPDATE bid_anchors SET hash = $2 WHERE lot_id = $1', [lot, 'x'])).rejects.toThrow(/somente inserção/);
    await expect(anchorPool.query('DELETE FROM bid_anchors WHERE lot_id = $1', [lot])).rejects.toThrow(/somente inserção/);
  });

  it('lote inexistente → 404', async () => {
    expect((await request(app).get('/api/lots/999999/audit')).status).toBe(404);
  });
});
