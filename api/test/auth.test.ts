import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.ts';
import { app, registerAs, resetDb } from './helpers.ts';

beforeAll(resetDb);
afterAll(() => pool.end());

describe('auth', () => {
  it('registra, mantém sessão por cookie httpOnly e cria carteira zerada', async () => {
    const { agent, user } = await registerAs('BIDDER', 'Fulano@T.local');
    expect(user.alias).toMatch(/^Licitante #[0-9A-F]{6}$/);
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('fulano@t.local');
    const wallet = await pool.query('SELECT balance_cents, committed_cents FROM wallets WHERE user_id = $1', [user.id]);
    expect(wallet.rows[0]).toEqual({ balance_cents: 0, committed_cents: 0 });
  });

  it('rejeita e-mail duplicado', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: 'fulano@t.local', password: 'senha-forte-1', name: 'Outro', role: 'BIDDER' });
    expect(res.status).toBe(409);
  });

  it('login com senha errada → 401; correta → cookie', async () => {
    const bad = await request(app).post('/api/auth/login').send({ email: 'fulano@t.local', password: 'errada-123' });
    expect(bad.status).toBe(401);
    const ok = await request(app).post('/api/auth/login').send({ email: 'FULANO@t.local', password: 'senha-forte-1' });
    expect(ok.status).toBe(200);
    expect(ok.headers['set-cookie'][0]).toMatch(/HttpOnly/);
  });

  it('sem sessão ou com token forjado → 401', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const forged = await request(app).get('/api/auth/me').set('Cookie', 'token=eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.');
    expect(forged.status).toBe(401);
  });

  it('valida entrada (papel inválido, senha curta)', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: 'a@t.local', password: '123', name: 'X', role: 'ADMIN' });
    expect(res.status).toBe(400);
  });
});
