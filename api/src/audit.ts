import { createHash } from 'node:crypto';

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
