import type pg from 'pg';

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
