import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../src/db.ts';
import { app, insertLot, registerAs, resetDb } from './helpers.ts';

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
afterAll(() => pool.end());

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
    expect((await seller.agent.post(`/api/lots/${id}/cancel`)).status).toBe(204);
    const vitrine = await request(app).get('/api/lots');
    const all = [...vitrine.body.live, ...vitrine.body.scheduled, ...vitrine.body.ended].map((l: any) => l.id);
    expect(all).not.toContain(id);
    const mine = await seller.agent.get('/api/lots/mine');
    expect(mine.body.find((l: any) => l.id === id).status).toBe('CANCELLED');
  });

  it('não cancela lote com lances nem encerrado', async () => {
    const withBid = await insertLot(seller.user.id);
    await pool.query('UPDATE lots SET bid_count = 1, current_bid_cents = 10000, leader_id = $2 WHERE id = $1', [withBid, bidder.user.id]);
    expect((await seller.agent.post(`/api/lots/${withBid}/cancel`)).body.code).toBe('LOT_HAS_BIDS');
    const ended = await insertLot(seller.user.id, { startOffsetS: -1200, endOffsetS: -600 });
    expect((await seller.agent.post(`/api/lots/${ended}/cancel`)).body.code).toBe('LOT_ENDED');
  });

  it('busca na vitrine filtra por título', async () => {
    const res = await request(app).get('/api/lots?q=inexistente-xyz');
    expect(res.body).toEqual({ live: [], scheduled: [], ended: [] });
  });
});
