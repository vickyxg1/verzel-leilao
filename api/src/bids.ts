import { Router } from 'express';
import { z } from 'zod';
import { bidHash } from './audit.ts';
import { requireRole } from './auth.ts';
import { pool, tx } from './db.ts';
import { AppError } from './errors.ts';

export const ANTI_SNIPING_MS = 120_000;
const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export type PlacedBid = {
  lotId: number;
  seq: number;
  amountCents: number;
  bidderAlias: string;
  createdAt: Date;
  endsAt: Date;
  extended: boolean;
  previousLeaderId: number | null;
  hash: string;
};

// Regras de lance (PDF p.4), tudo numa transação:
// 1. FOR UPDATE no lote: lances do mesmo lote são processados um de cada vez.
// 2. Relógio lido DEPOIS do lock (clock_timestamp, não now()): quem esperou o lock é julgado pelo horário real.
// 3. Carteiras do novo líder e do anterior travadas em ordem de user_id (evita deadlock).
// 4. Libera reserva do líder anterior, reserva o valor do novo, grava lance encadeado, prorroga se preciso.
export async function placeBid(lotId: number, bidderId: number, amountCents: number): Promise<PlacedBid> {
  return tx(async (c) => {
    const lotRes = await c.query(
      `SELECT id, starts_at, ends_at, cancelled_at, leader_id, current_bid_cents, starting_price_cents,
              min_increment_cents, bid_count, last_hash
       FROM lots WHERE id = $1 FOR UPDATE`,
      [lotId],
    );
    const lot = lotRes.rows[0];
    if (!lot) throw new AppError(404, 'LOT_NOT_FOUND', 'Lote não encontrado');

    const { rows: [{ t }] } = await c.query(`SELECT date_trunc('milliseconds', clock_timestamp()) AS t`);
    const now: Date = t;
    if (lot.cancelled_at) throw new AppError(409, 'LOT_CANCELLED', 'Lote cancelado');
    if (now < lot.starts_at) throw new AppError(409, 'LOT_NOT_STARTED', 'O lote ainda não começou');
    if (now >= lot.ends_at) throw new AppError(409, 'LOT_ENDED', 'O lote já foi encerrado');
    if (lot.leader_id === bidderId) throw new AppError(409, 'ALREADY_LEADING', 'Você já está ganhando este lote');

    const minCents = lot.current_bid_cents == null ? lot.starting_price_cents : lot.current_bid_cents + lot.min_increment_cents;
    if (amountCents < minCents) {
      throw new AppError(422, 'BID_TOO_LOW', `Lance abaixo do mínimo: o menor lance aceito é ${brl(minCents)}`);
    }

    const ids = [bidderId, lot.leader_id].filter((id): id is number => id != null).sort((a, b) => a - b);
    const wallets = await c.query(
      'SELECT user_id, balance_cents, committed_cents FROM wallets WHERE user_id = ANY($1) ORDER BY user_id FOR UPDATE',
      [ids],
    );
    const mine = wallets.rows.find((w) => w.user_id === bidderId)!;
    const available = mine.balance_cents - mine.committed_cents;
    if (available < amountCents) {
      throw new AppError(422, 'INSUFFICIENT_FUNDS', `Saldo insuficiente: disponível ${brl(available)}, lance ${brl(amountCents)}`);
    }

    if (lot.leader_id != null) {
      await c.query('UPDATE wallets SET committed_cents = committed_cents - $2 WHERE user_id = $1', [lot.leader_id, lot.current_bid_cents]);
    }
    await c.query('UPDATE wallets SET committed_cents = committed_cents + $2 WHERE user_id = $1', [bidderId, amountCents]);

    // Anti-sniping: lance aceito com 120 s ou menos para o fim empurra o fim em +120 s.
    const extended = lot.ends_at.getTime() - now.getTime() <= ANTI_SNIPING_MS;
    const endsAt = extended ? new Date(lot.ends_at.getTime() + ANTI_SNIPING_MS) : lot.ends_at;

    const { rows: [{ public_alias: alias }] } = await c.query('SELECT public_alias FROM users WHERE id = $1', [bidderId]);
    const seq = lot.bid_count + 1;
    const hash = bidHash({ lot_id: lotId, seq, bidder_alias: alias, amount_cents: amountCents, created_at: now, prev_hash: lot.last_hash });
    await c.query(
      `INSERT INTO bids (lot_id, seq, bidder_id, amount_cents, created_at, prev_hash, hash) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [lotId, seq, bidderId, amountCents, now, lot.last_hash, hash],
    );
    await c.query(
      `UPDATE lots SET leader_id = $2, current_bid_cents = $3, bid_count = $4, last_hash = $5, ends_at = $6 WHERE id = $1`,
      [lotId, bidderId, amountCents, seq, hash, endsAt],
    );

    return { lotId, seq, amountCents, bidderAlias: alias, createdAt: now, endsAt, extended, previousLeaderId: lot.leader_id, hash };
  });
}

export const bidsRouter = Router({ mergeParams: true });

bidsRouter.post('/', requireRole('BIDDER'), async (req, res) => {
  const lotId = z.coerce.number().int().positive().parse((req.params as { id: string }).id);
  const { amountCents } = z.object({ amountCents: z.number().int().positive().max(100_000_000_00) }).parse(req.body);
  const { previousLeaderId: _, ...bid } = await placeBid(lotId, req.user!.id, amountCents);
  res.status(201).json(bid);
});

// Histórico público: só pseudônimo, valor, horário e hashes.
bidsRouter.get('/', async (req, res) => {
  const lotId = z.coerce.number().int().positive().parse((req.params as { id: string }).id);
  const { rows } = await pool.query(
    `SELECT b.seq, u.public_alias AS bidder_alias, b.amount_cents, b.created_at, b.prev_hash, b.hash
     FROM bids b JOIN users u ON u.id = b.bidder_id WHERE b.lot_id = $1 ORDER BY b.seq DESC`,
    [lotId],
  );
  res.json(rows);
});
