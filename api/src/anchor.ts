// Âncora independente da auditoria: banco SEPARADO (outro projeto Supabase, outra credencial),
// onde cada lance aceito registra (lote, seq, hash). Quem altera o banco principal não altera a âncora.
import pg from 'pg';
import { config } from './config.ts';

export const anchorPool = new pg.Pool({
  connectionString: config.anchorDatabaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 3,
});

// Append-only também por trigger: UPDATE/DELETE falham mesmo para quem tem permissão na tabela.
// Em produção a API usa um usuário só com INSERT/SELECT (ver README).
export async function ensureAnchorSchema() {
  await anchorPool.query(`
    CREATE TABLE IF NOT EXISTS bid_anchors (
      lot_id      BIGINT NOT NULL,
      seq         INT NOT NULL,
      hash        TEXT NOT NULL,
      anchored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (lot_id, seq)
    );
    CREATE OR REPLACE FUNCTION bid_anchors_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'bid_anchors é somente inserção'; END $$;
    DROP TRIGGER IF EXISTS bid_anchors_no_change ON bid_anchors;
    CREATE TRIGGER bid_anchors_no_change BEFORE UPDATE OR DELETE ON bid_anchors
      FOR EACH ROW EXECUTE FUNCTION bid_anchors_append_only();
  `);
}

// Chamado logo após o commit do lance, com o hash calculado pela própria API (não relido do banco
// principal, que poderia ter sido adulterado). Se falhar após as tentativas, o lance fica sem âncora
// e a auditoria pública mostra isso como alerta.
export async function anchorBid(lotId: number, seq: number, hash: string) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await anchorPool.query(
        'INSERT INTO bid_anchors (lot_id, seq, hash) VALUES ($1, $2, $3) ON CONFLICT (lot_id, seq) DO NOTHING',
        [lotId, seq, hash],
      );
      return true;
    } catch (err) {
      if (attempt === 3) {
        console.error(`falha ao ancorar lote ${lotId} seq ${seq}`, err);
        return false;
      }
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
  return false;
}

export async function getAnchors(lotId: number): Promise<{ seq: number; hash: string; anchored_at: Date }[]> {
  const { rows } = await anchorPool.query('SELECT seq, hash, anchored_at FROM bid_anchors WHERE lot_id = $1 ORDER BY seq', [lotId]);
  return rows;
}
