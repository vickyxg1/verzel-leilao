import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.ts';
import { closeDb, insertLot, registerAs, resetDb } from './helpers.ts';

type Agent = Awaited<ReturnType<typeof registerAs>>;
let seller: Agent;
let bidder: Agent;

beforeAll(async () => {
  await resetDb();
  seller = await registerAs('AUCTIONEER');
  bidder = await registerAs('BIDDER');
  await bidder.agent.post('/api/wallet/deposit').send({ amountCents: 100_000 });
  config.supabaseUrl = 'https://exemplo.supabase.co';
  config.supabaseSecretKey = 'chave-teste';
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  config.supabaseUrl = undefined;
  config.supabaseSecretKey = undefined;
  await closeDb();
});

const broadcasts = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/realtime/v1/api/broadcast'));

describe('tempo real (Supabase Broadcast)', () => {
  it('lance aceito publica "changed" no tópico do lote e da vitrine, depois do commit', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const lotId = await insertLot(seller.user.id);

    expect((await bidder.agent.post(`/api/lots/${lotId}/bids`).send({ amountCents: 10_000 })).status).toBe(201);

    const calls = broadcasts(fetchMock);
    expect(calls).toHaveLength(1);
    const [, init] = calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).apikey).toBe('chave-teste');
    expect(JSON.parse(init.body as string).messages).toEqual([
      { topic: `lot:${lotId}`, event: 'changed', payload: { lotId } },
      { topic: 'lots', event: 'changed', payload: { lotId } },
    ]);
  });

  it('lance rejeitado não publica nada', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const lotId = await insertLot(seller.user.id);

    expect((await bidder.agent.post(`/api/lots/${lotId}/bids`).send({ amountCents: 1 })).status).toBe(422);
    expect(broadcasts(fetchMock)).toHaveLength(0);
  });

  it('Realtime fora do ar não desfaz nem quebra o lance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rede caiu'); }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const lotId = await insertLot(seller.user.id);

    const res = await bidder.agent.post(`/api/lots/${lotId}/bids`).send({ amountCents: 10_000 });
    expect(res.status).toBe(201);
    expect((await bidder.agent.get(`/api/lots/${lotId}`)).body.current_bid_cents).toBe(10_000);
  });
});

