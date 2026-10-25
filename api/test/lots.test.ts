import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../src/db.ts';
import { app, insertLot, registerAs, closeDb, resetDb } from './helpers.ts';

// API externa simulada: testes não dependem da internet.
function mockAic(mode: 'ok' | 'timeout' | 'down' | 'ratelimit' = 'ok') {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (mode === 'timeout') throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    if (mode === 'down') throw new TypeError('fetch failed');
    if (mode === 'ratelimit') return new Response('', { status: 429 });
    if (url.includes('/iiif/')) return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
    if (url.includes('/artworks/search')) {
      return Response.json({ data: [{ id: 7, title: 'Busca', image_id: 'img7' }, { id: 8, title: 'Sem imagem', image_id: null }] });
    }
    return Response.json({ data: { id: 16568, title: 'Water Lilies', artist_display: 'Monet', date_display: '1906', image_id: 'abc' } });
  });
}

const future = (s: number) => new Date(Date.now() + s * 1000).toISOString();
const validLot = () => ({ externalId: '16568', startingPriceCents: 10_000, minIncrementCents: 500, startsAt: future(60), endsAt: future(3600) });

let seller: Awaited<ReturnType<typeof registerAs>>;
let otherSeller: Awaited<ReturnType<typeof registerAs>>;
let bidder: Awaited<ReturnType<typeof registerAs>>;

beforeAll(async () => {
  await resetDb();
  seller = await registerAs('AUCTIONEER');
  otherSeller = await registerAs('AUCTIONEER');
  bidder = await registerAs('BIDDER');
});
afterEach(() => vi.restoreAllMocks());
afterAll(closeDb);

describe('busca na API externa', () => {
  it('lista só itens com imagem', async () => {
    mockAic();
    const res = await seller.agent.get('/api/items/search?q=monet');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([expect.objectContaining({ externalId: '7', title: 'Busca' })]);
  });

  it.each([
    ['timeout', 504, 'EXTERNAL_TIMEOUT'],
    ['down', 502, 'EXTERNAL_UNAVAILABLE'],
    ['ratelimit', 503, 'EXTERNAL_RATE_LIMIT'],
  ] as const)('falha %s → %i com mensagem clara', async (mode, status, code) => {
    mockAic(mode);
    const res = await seller.agent.get(`/api/items/search?q=${mode}x`);
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
  });

  it('licitante não acessa busca de leiloeiro', async () => {
    expect((await bidder.agent.get('/api/items/search?q=monet')).status).toBe(403);
  });
});

describe('criação de lote', () => {
  it('leiloeiro cria lote; snapshot (com imagem) é buscado no servidor', async () => {
    mockAic();
    const res = await seller.agent.post('/api/lots').send(validLot());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Water Lilies', artist: 'Monet', status: 'SCHEDULED', next_min_cents: 10_000 });
    expect(res.body).not.toHaveProperty('seller_id');
    const img = await request(app).get(res.body.imageUrl);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
  });

  it('licitante não cria lote (403)', async () => {
    expect((await bidder.agent.post('/api/lots').send(validLot())).status).toBe(403);
  });

  it('rejeita fim antes do início e início no passado', async () => {
    mockAic();
    expect((await seller.agent.post('/api/lots').send({ ...validLot(), endsAt: future(30) })).status).toBe(400);
    expect((await seller.agent.post('/api/lots').send({ ...validLot(), startsAt: future(-3600) })).status).toBe(400);
  });

  it('API externa fora do ar na criação → erro claro, nada persistido', async () => {
    mockAic('down');
    const before = (await pool.query('SELECT count(*)::int n FROM lots')).rows[0].n;
    expect((await seller.agent.post('/api/lots').send(validLot())).status).toBe(502);
    expect((await pool.query('SELECT count(*)::int n FROM lots')).rows[0].n).toBe(before);
  });
});

describe('vitrine e cancelamento', () => {
  it('vitrine separa ao vivo/agendado/encerrado e funciona com API externa fora (T17)', async () => {
    const live = await insertLot(seller.user.id);
    const scheduled = await insertLot(seller.user.id, { startOffsetS: 600, endOffsetS: 1200 });
    const ended = await insertLot(seller.user.id, { startOffsetS: -1200, endOffsetS: -600 });
    const fetchSpy = mockAic('down');
    const res = await request(app).get('/api/lots');
    expect(res.status).toBe(200);
    expect(res.body.live.map((l: any) => l.id)).toContain(live);
    expect(res.body.scheduled.map((l: any) => l.id)).toContain(scheduled);
    expect(res.body.ended.map((l: any) => l.id)).toContain(ended);
    expect((await request(app).get(`/api/lots/${live}`)).status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('outro leiloeiro e licitante não cancelam lote alheio (T02)', async () => {
    const id = await insertLot(seller.user.id);
    expect((await otherSeller.agent.post(`/api/lots/${id}/cancel`)).status).toBe(403);
    expect((await bidder.agent.post(`/api/lots/${id}/cancel`)).status).toBe(403);
    expect((await pool.query('SELECT cancelled_at FROM lots WHERE id = $1', [id])).rows[0].cancelled_at).toBeNull();
  });

  it('dono cancela lote sem lances; some da vitrine, aparece no painel', async () => {
    const id = await insertLot(seller.user.id);
    const res = await seller.agent.post(`/api/lots/${id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ refundedCents: 0 });
    const vitrine = await request(app).get('/api/lots');
    const all = [...vitrine.body.live, ...vitrine.body.scheduled, ...vitrine.body.ended].map((l: any) => l.id);
    expect(all).not.toContain(id);
    const mine = await seller.agent.get('/api/lots/mine');
    expect(mine.body.lots.find((l: any) => l.id === id).status).toBe('CANCELLED');
  });

  it('não cancela lote encerrado nem já cancelado', async () => {
    const ended = await insertLot(seller.user.id, { startOffsetS: -1200, endOffsetS: -600 });
    expect((await seller.agent.post(`/api/lots/${ended}/cancel`)).body.code).toBe('LOT_ENDED');
    const id = await insertLot(seller.user.id);
    await seller.agent.post(`/api/lots/${id}/cancel`);
    expect((await seller.agent.post(`/api/lots/${id}/cancel`)).body.code).toBe('LOT_CANCELLED');
  });
});

describe('cancelamento com estorno automático (opcional p. 6)', () => {
  const wallet = async (b: typeof bidder) => (await b.agent.get('/api/wallet')).body;
  const bid = (b: typeof bidder, lotId: number, amountCents: number) => b.agent.post(`/api/lots/${lotId}/bids`).send({ amountCents });
  let ana: typeof bidder;
  let bruno: typeof bidder;

  beforeAll(async () => {
    ana = await registerAs('BIDDER');
    bruno = await registerAs('BIDDER');
    await ana.agent.post('/api/wallet/deposit').send({ amountCents: 100_000 });
    await bruno.agent.post('/api/wallet/deposit').send({ amountCents: 100_000 });
  });

  it('cancelar lote com lances devolve a reserva do líder, registra no extrato e não liquida depois', async () => {
    const id = await insertLot(seller.user.id, { endOffsetS: 3 });
    expect((await bid(ana, id, 10_000)).status).toBe(201);
    expect((await bid(bruno, id, 11_000)).status).toBe(201);
    expect((await wallet(bruno)).committed_cents).toBe(11_000);

    const res = await seller.agent.post(`/api/lots/${id}/cancel`);
    expect(res.body).toEqual({ refundedCents: 11_000 });
    const w = await wallet(bruno);
    expect(w).toMatchObject({ balance_cents: 100_000, committed_cents: 0, available_cents: 100_000 });
    expect(w.entries[0]).toMatchObject({ kind: 'CANCEL_RELEASE', amount_cents: 11_000, lot_id: id });
    expect(await wallet(ana)).toMatchObject({ committed_cents: 0 });
    expect((await bid(ana, id, 12_000)).body.code).toBe('LOT_CANCELLED');

    // depois do fim o agendador não liquida lote cancelado: ninguém é debitado
    await new Promise((r) => setTimeout(r, 3_100));
    await pool.query('SELECT settle_due_lots()');
    expect((await pool.query('SELECT count(*)::int n FROM settlements WHERE lot_id = $1', [id])).rows[0].n).toBe(0);
    expect((await wallet(bruno)).balance_cents).toBe(100_000);
    // auditoria do histórico continua íntegra após o cancelamento
    expect((await request(app).get(`/api/lots/${id}/audit`)).body.status).toBe('INTEGRO');
  });

  it('cancelamento e lance simultâneos: reservas ficam consistentes com o resultado', async () => {
    const id = await insertLot(seller.user.id);
    await bid(ana, id, 10_000);
    await Promise.all([seller.agent.post(`/api/lots/${id}/cancel`), bid(bruno, id, 20_000)]);
    const { rows: [lot] } = await pool.query('SELECT cancelled_at FROM lots WHERE id = $1', [id]);
    expect(lot.cancelled_at).not.toBeNull();
    // com o lote cancelado, ninguém pode ficar com valor reservado nele
    expect((await wallet(ana)).committed_cents).toBe(0);
    expect((await wallet(bruno)).committed_cents).toBe(0);
  });

  it('lote liquidado não pode ser cancelado nem pelo banco', async () => {
    const id = await insertLot(seller.user.id, { startOffsetS: -1200, endOffsetS: -600 });
    await pool.query('SELECT settle_lot($1)', [id]);
    await expect(pool.query('UPDATE lots SET cancelled_at = now() WHERE id = $1', [id])).rejects.toThrow(/lots_cancel_before_settle/);
  });

  it('busca na vitrine filtra por título', async () => {
    const res = await request(app).get('/api/lots?q=inexistente-xyz');
    expect(res.body).toEqual({ live: [], scheduled: [], ended: [] });
  });
});
