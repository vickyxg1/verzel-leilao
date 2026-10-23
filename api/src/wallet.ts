import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { requireRole } from './auth.ts';
import { pool, tx } from './db.ts';

// Depósito simulado. idempotencyKey repetida não credita de novo. Retorna se creditou.
export async function deposit(c: pg.PoolClient, userId: number, cents: number, idempotencyKey: string) {
  const inserted = await c.query(
    `INSERT INTO wallet_entries (user_id, kind, amount_cents, idempotency_key)
     VALUES ($1, 'DEPOSIT', $2, $3) ON CONFLICT (idempotency_key) DO NOTHING`,
    [userId, cents, idempotencyKey],
  );
  if (!inserted.rowCount) return false;
  await c.query('UPDATE wallets SET balance_cents = balance_cents + $2 WHERE user_id = $1', [userId, cents]);
  return true;
}

export async function getWallet(userId: number) {
  const { rows: [w] } = await pool.query('SELECT balance_cents, committed_cents FROM wallets WHERE user_id = $1', [userId]);
  const { rows: entries } = await pool.query(
    `SELECT e.id, e.kind, e.amount_cents, e.lot_id, e.created_at
     FROM wallet_entries e WHERE e.user_id = $1 ORDER BY e.created_at DESC LIMIT 50`,
    [userId],
  );
  return {
    balance_cents: w.balance_cents,
    committed_cents: w.committed_cents,
    available_cents: w.balance_cents - w.committed_cents,
    entries,
  };
}

export const walletRouter = Router();

walletRouter.get('/', requireRole(), async (req, res) => {
  res.json(await getWallet(req.user!.id));
});

walletRouter.post('/deposit', requireRole('BIDDER'), async (req, res) => {
  const input = z.object({
    amountCents: z.number().int().positive().max(1_000_000_00), // até R$ 1 milhão por depósito
    // gerada pelo front por clique: duplo clique/retry não deposita duas vezes
    idempotencyKey: z.string().uuid().optional(),
  }).parse(req.body);
  const key = `deposit:${req.user!.id}:${input.idempotencyKey ?? randomUUID()}`;
  await tx((c) => deposit(c, req.user!.id, input.amountCents, key));
  res.status(201).json(await getWallet(req.user!.id));
});
