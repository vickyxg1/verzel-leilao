import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getAnchors } from './anchor.ts';
import { pool } from './db.ts';
import { AppError } from './errors.ts';

export const GENESIS_HASH = '0'.repeat(64);

export type ChainedBid = {
  lot_id: number;
  seq: number;
  bidder_alias: string;
  amount_cents: number;
  created_at: Date | string;
  prev_hash: string;
};

// Hash de um lance a partir só de dados públicos: qualquer pessoa consegue recalcular a cadeia.
// created_at é gravado com precisão de milissegundos para bater com o ISO do JavaScript.
export function bidHash(b: ChainedBid): string {
  const canonical = JSON.stringify([
    b.lot_id,
    b.seq,
    b.bidder_alias,
    b.amount_cents,
    new Date(b.created_at).toISOString(),
    b.prev_hash,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

export type AuditStatus = 'INTEGRO' | 'ADULTERADO' | 'NAO_CONFIRMADO';
type Issue = { severity: 'ADULTERACAO' | 'ALERTA'; seq: number | null; message: string };

// Verificação em 3 camadas:
// 1. cadeia interna: seq contínua, prev_hash ligando cada lance ao anterior, hash recalculado bate;
// 2. âncora externa: cada (seq, hash) gravado no banco separado no momento do lance precisa existir igual;
//    pega reescrita completa da cadeia, remoção do último lance e inserção retroativa;
// 3. coerência com lote e comprovante (líder, valor atual, valor liquidado).
export async function verifyLot(lotId: number) {
  const { rows: [lot] } = await pool.query(
    `SELECT l.id, l.bid_count, l.last_hash, l.current_bid_cents, leader.public_alias AS leader_alias,
            st.amount_cents AS settled_amount, st.final_hash AS settled_hash, st.final_bid_seq AS settled_seq
     FROM lots l
     LEFT JOIN users leader ON leader.id = l.leader_id
     LEFT JOIN settlements st ON st.lot_id = l.id
     WHERE l.id = $1`,
    [lotId],
  );
  if (!lot) throw new AppError(404, 'LOT_NOT_FOUND', 'Lote não encontrado');

  const { rows: bids } = await pool.query(
    `SELECT b.seq, u.public_alias AS bidder_alias, b.amount_cents, b.created_at, b.prev_hash, b.hash
     FROM bids b JOIN users u ON u.id = b.bidder_id WHERE b.lot_id = $1 ORDER BY b.seq`,
    [lotId],
  );

  let anchors: Awaited<ReturnType<typeof getAnchors>> | null;
  try {
    anchors = await getAnchors(lotId);
  } catch {
    anchors = null; // âncora fora do ar: só a cadeia interna é verificada
  }

  const issues: Issue[] = [];
  const tamper = (seq: number | null, message: string) => issues.push({ severity: 'ADULTERACAO', seq, message });

  let prev = GENESIS_HASH;
  bids.forEach((b, i) => {
    if (b.seq !== i + 1) tamper(b.seq, `Sequência quebrada: esperado lance #${i + 1}, encontrado #${b.seq} (remoção ou inserção)`);
    if (b.prev_hash !== prev) tamper(b.seq, `Lance #${b.seq} não aponta para o hash do lance anterior`);
    if (bidHash({ lot_id: lotId, ...b }) !== b.hash) tamper(b.seq, `Conteúdo do lance #${b.seq} não corresponde ao seu hash (alteração)`);
    prev = b.hash;
  });

  const anchoredSeqs = new Set<number>();
  if (anchors) {
    const bySeq = new Map(bids.map((b) => [b.seq, b]));
    for (const a of anchors) {
      anchoredSeqs.add(a.seq);
      const b = bySeq.get(a.seq);
      if (!b) tamper(a.seq, `Lance #${a.seq} consta na âncora independente mas não existe mais no banco (remoção)`);
      else if (b.hash !== a.hash) tamper(a.seq, `Lance #${a.seq} difere do registrado na âncora independente (alteração ou inserção retroativa)`);
    }
    for (const b of bids) {
      if (!anchoredSeqs.has(b.seq)) {
        issues.push({ severity: 'ALERTA', seq: b.seq, message: `Lance #${b.seq} não consta na âncora independente (possível inserção direta no banco ou falha ao ancorar)` });
      }
    }
  } else {
    issues.push({ severity: 'ALERTA', seq: null, message: 'Âncora independente indisponível: apenas a cadeia interna foi verificada' });
  }

  const last = bids.at(-1);
  if (lot.bid_count !== bids.length) tamper(null, `Lote registra ${lot.bid_count} lance(s), histórico tem ${bids.length}`);
  if (last && (lot.last_hash !== last.hash || lot.current_bid_cents !== last.amount_cents || lot.leader_alias !== last.bidder_alias)) {
    tamper(null, 'Lance vencedor do lote não corresponde ao último lance do histórico');
  }
  if (lot.settled_amount != null && (lot.settled_amount !== last?.amount_cents || lot.settled_hash !== last?.hash)) {
    tamper(null, 'Comprovante de arremate não corresponde ao último lance do histórico');
  }

  const status: AuditStatus = issues.some((i) => i.severity === 'ADULTERACAO')
    ? 'ADULTERADO'
    : issues.length ? 'NAO_CONFIRMADO' : 'INTEGRO';

  return {
    lot_id: lotId,
    status,
    issues,
    checked_at: new Date(),
    anchor_available: anchors !== null,
    bids: bids.map((b) => ({ ...b, anchored: anchoredSeqs.has(b.seq) })),
  };
}

export const auditRouter = Router({ mergeParams: true });

auditRouter.get('/', async (req, res) => {
  const lotId = z.coerce.number().int().positive().parse((req.params as { id: string }).id);
  res.set('Cache-Control', 'no-store').json(await verifyLot(lotId));
});
