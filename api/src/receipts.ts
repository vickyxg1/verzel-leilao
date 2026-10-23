import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from './auth.ts';
import { pool } from './db.ts';
import { AppError } from './errors.ts';
import { settleDue, STATUS_SQL } from './lots.ts';

// Comprovante público por link (token UUID não adivinhável). Só pseudônimos, sem dados pessoais.
export const receiptsRouter = Router();

receiptsRouter.get('/:token', async (req, res) => {
  const token = z.uuid().parse(req.params.token);
  const { rows: [r] } = await pool.query(
    `SELECT st.public_token AS token, st.lot_id, s.title, s.attributes->>'artist' AS artist,
            st.amount_cents, st.final_bid_seq, st.final_hash, st.settled_at,
            winner.public_alias AS winner_alias, seller.public_alias AS seller_alias
     FROM settlements st
     JOIN lots l ON l.id = st.lot_id
     JOIN item_snapshots s ON s.id = l.item_snapshot_id
     JOIN users seller ON seller.id = st.seller_id
     LEFT JOIN users winner ON winner.id = st.winner_id
     WHERE st.public_token = $1 AND st.winner_id IS NOT NULL`,
    [token],
  );
  if (!r) throw new AppError(404, 'RECEIPT_NOT_FOUND', 'Comprovante não encontrado');
  res.json({ ...r, imageUrl: `/api/lots/${r.lot_id}/image`, auditUrl: `/auditoria/${r.lot_id}` });
});

// "Meus arremates": lotes em que o licitante deu lance, com resultado e link do comprovante se venceu.
export const participationsRouter = Router();

participationsRouter.get('/', requireRole('BIDDER'), async (req, res) => {
  await settleDue();
  const { rows } = await pool.query(
    `SELECT l.id, s.title, ${STATUS_SQL} AS status, l.ends_at, l.current_bid_cents,
            max(b.amount_cents) AS my_best_cents, count(b.id)::int AS my_bids,
            (l.leader_id = $1) AS leading,
            (st.winner_id = $1) AS won,
            CASE WHEN st.winner_id = $1 THEN st.public_token END AS receipt_token
     FROM bids b
     JOIN lots l ON l.id = b.lot_id
     JOIN item_snapshots s ON s.id = l.item_snapshot_id
     LEFT JOIN settlements st ON st.lot_id = l.id
     WHERE b.bidder_id = $1
     GROUP BY l.id, s.title, st.winner_id, st.public_token
     ORDER BY l.ends_at DESC`,
    [req.user!.id],
  );
  res.json(rows.map((r) => ({ ...r, won: r.won === true })));
});
