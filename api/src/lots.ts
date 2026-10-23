import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from './auth.ts';
import { pool, tx } from './db.ts';
import { AppError } from './errors.ts';
import { fetchArtworkSnapshot } from './items.ts';

// Estado derivado do relógio do banco: nunca gravado, nunca vindo do cliente.
// Janela de lance: starts_at <= now() < ends_at.
export const STATUS_SQL = `CASE
  WHEN l.cancelled_at IS NOT NULL THEN 'CANCELLED'
  WHEN now() < l.starts_at THEN 'SCHEDULED'
  WHEN now() < l.ends_at THEN 'LIVE'
  ELSE 'ENDED' END`;

// Visão pública do lote: só pseudônimo do líder, nada de e-mail/nome/saldo.
const LOT_SELECT = `
  SELECT l.id, ${STATUS_SQL} AS status, s.title, s.attributes, s.source_url,
         l.starting_price_cents, l.min_increment_cents, l.current_bid_cents, l.bid_count,
         l.starts_at, l.ends_at, l.original_ends_at, l.cancelled_at, l.created_at,
         seller.public_alias AS seller_alias, leader.public_alias AS leader_alias,
         l.settled_at, st.amount_cents AS final_amount_cents, winner.public_alias AS winner_alias,
         now() AS server_now
  FROM lots l
  JOIN item_snapshots s ON s.id = l.item_snapshot_id
  JOIN users seller ON seller.id = l.seller_id
  LEFT JOIN users leader ON leader.id = l.leader_id
  LEFT JOIN settlements st ON st.lot_id = l.id
  LEFT JOIN users winner ON winner.id = st.winner_id`;

// Rede de segurança do pg_cron: quem consulta um lote vencido já o vê liquidado. Idempotente.
export const settleDue = () => pool.query('SELECT settle_due_lots()');

function present(row: Record<string, any>): Record<string, any> {
  const { attributes, source_url, ...rest } = row;
  return {
    ...rest,
    artist: attributes.artist,
    date: attributes.date,
    medium: attributes.medium,
    origin: attributes.origin,
    sourceUrl: source_url,
    imageUrl: `/api/lots/${row.id}/image`,
    // mínimo aceito no próximo lance (B02)
    next_min_cents: row.current_bid_cents == null ? row.starting_price_cents : row.current_bid_cents + row.min_increment_cents,
  };
}

const createLot = z.object({
  externalId: z.string().regex(/^\d{1,12}$/),
  startingPriceCents: z.number().int().positive().max(100_000_000_00),
  minIncrementCents: z.number().int().positive().max(100_000_000_00),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
}).refine((d) => d.endsAt.getTime() - d.startsAt.getTime() >= 60_000, {
  message: 'O fim deve ser pelo menos 1 minuto depois do início', path: ['endsAt'],
}).refine((d) => d.startsAt.getTime() >= Date.now() - 60_000, {
  message: 'O início não pode estar no passado', path: ['startsAt'],
});

export const lotsRouter = Router();

// Vitrine pública: cancelados nunca aparecem. ?q= filtra por título/artista (opcional do edital).
lotsRouter.get('/', async (req, res) => {
  const { q } = z.object({ q: z.string().trim().max(100).optional() }).parse(req.query);
  const { rows } = await pool.query(
    `${LOT_SELECT}
     WHERE l.cancelled_at IS NULL
       AND ($1::text IS NULL OR s.title ILIKE '%' || $1 || '%' OR s.attributes->>'artist' ILIKE '%' || $1 || '%')
     ORDER BY l.ends_at`,
    [q || null],
  );
  const lots = rows.map(present);
  res.json({
    live: lots.filter((l) => l.status === 'LIVE'),
    scheduled: lots.filter((l) => l.status === 'SCHEDULED'),
    ended: lots.filter((l) => l.status === 'ENDED').reverse(),
  });
});

// Painel do leiloeiro: todos os próprios lotes, inclusive cancelados.
lotsRouter.get('/mine', requireRole('AUCTIONEER'), async (req, res) => {
  await settleDue();
  const { rows } = await pool.query(`${LOT_SELECT} WHERE l.seller_id = $1 ORDER BY l.created_at DESC`, [req.user!.id]);
  const lots = rows.map(present);
  res.json({
    lots,
    total_received_cents: lots.reduce((sum, l) => sum + (l.final_amount_cents ?? 0), 0),
  });
});

lotsRouter.get('/:id', async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  // só trava o lote se ele já venceu e não foi liquidado (leitura comum não disputa lock com lances)
  await pool.query(
    'SELECT settle_lot(id) FROM lots WHERE id = $1 AND settled_at IS NULL AND cancelled_at IS NULL AND ends_at <= now()',
    [id],
  );
  const { rows } = await pool.query(`${LOT_SELECT} WHERE l.id = $1`, [id]);
  if (!rows[0]) throw new AppError(404, 'LOT_NOT_FOUND', 'Lote não encontrado');
  res.json(present(rows[0]));
});

// Imagem servida do snapshot local: funciona com a API externa fora do ar.
lotsRouter.get('/:id/image', async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const { rows } = await pool.query(
    `SELECT s.image_bytes, s.image_mime FROM lots l JOIN item_snapshots s ON s.id = l.item_snapshot_id WHERE l.id = $1`,
    [id],
  );
  if (!rows[0]?.image_bytes) throw new AppError(404, 'IMAGE_NOT_FOUND', 'Imagem não encontrada');
  res.set('Content-Type', rows[0].image_mime).set('Cache-Control', 'public, max-age=86400, immutable').send(rows[0].image_bytes);
});

lotsRouter.post('/', requireRole('AUCTIONEER'), async (req, res) => {
  const input = createLot.parse(req.body);
  // Busca fora da transação: não segura conexão do banco esperando a API externa.
  const item = await fetchArtworkSnapshot(input.externalId);
  const id = await tx(async (c) => {
    const snap = await c.query(
      `INSERT INTO item_snapshots (source, external_id, title, attributes, image_bytes, image_mime, source_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [item.source, item.externalId, item.title, item.attributes, item.imageBytes, item.imageMime, item.sourceUrl],
    );
    const lot = await c.query(
      `INSERT INTO lots (seller_id, item_snapshot_id, starting_price_cents, min_increment_cents, starts_at, ends_at, original_ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
      [req.user!.id, snap.rows[0].id, input.startingPriceCents, input.minIncrementCents, input.startsAt, input.endsAt],
    );
    return lot.rows[0].id as number;
  });
  const { rows } = await pool.query(`${LOT_SELECT} WHERE l.id = $1`, [id]);
  res.status(201).json(present(rows[0]));
});

// Cancelamento: só o dono, só sem lances e antes do fim. FOR UPDATE serializa com lances concorrentes.
lotsRouter.post('/:id/cancel', requireRole('AUCTIONEER'), async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT l.seller_id, l.bid_count, ${STATUS_SQL} AS status FROM lots l WHERE l.id = $1 FOR UPDATE`,
      [id],
    );
    const lot = rows[0];
    if (!lot) throw new AppError(404, 'LOT_NOT_FOUND', 'Lote não encontrado');
    if (lot.seller_id !== req.user!.id) throw new AppError(403, 'NOT_LOT_OWNER', 'Você só pode gerenciar seus próprios lotes');
    if (lot.status === 'CANCELLED') throw new AppError(409, 'LOT_CANCELLED', 'Lote já cancelado');
    if (lot.status === 'ENDED') throw new AppError(409, 'LOT_ENDED', 'Lote já encerrado');
    if (lot.bid_count > 0) throw new AppError(409, 'LOT_HAS_BIDS', 'Lote com lances não pode ser cancelado');
    await c.query('UPDATE lots SET cancelled_at = now() WHERE id = $1', [id]);
  });
  res.status(204).end();
});
