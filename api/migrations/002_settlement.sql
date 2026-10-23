-- Encerramento e liquidação. A lógica fica no banco para rodar via pg_cron sem depender
-- de servidor Node ligado (Vercel é serverless). A API chama as mesmas funções.

ALTER TABLE lots ADD COLUMN settled_at TIMESTAMPTZ;
CREATE INDEX lots_unsettled_idx ON lots (ends_at) WHERE settled_at IS NULL AND cancelled_at IS NULL;

-- Comprovante: no máximo um por lote (UNIQUE garante liquidação única mesmo se tudo mais falhar).
CREATE TABLE settlements (
  id            BIGSERIAL PRIMARY KEY,
  lot_id        BIGINT NOT NULL UNIQUE REFERENCES lots(id),
  public_token  UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  winner_id     BIGINT REFERENCES users(id),
  seller_id     BIGINT NOT NULL REFERENCES users(id),
  amount_cents  BIGINT,
  final_bid_seq INT,
  final_hash    TEXT,
  settled_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((winner_id IS NULL) = (amount_cents IS NULL))
);

-- Liquida um lote se já venceu. Idempotente: segunda chamada não faz nada e devolve false.
-- Lock do lote primeiro, depois carteiras em ordem de user_id (mesma ordem do lance: sem deadlock).
CREATE FUNCTION settle_lot(p_lot_id BIGINT) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  l lots%ROWTYPE;
BEGIN
  SELECT * INTO l FROM lots WHERE id = p_lot_id FOR UPDATE;
  -- relógio lido após o lock: se um lance prorrogou o fim enquanto esperávamos, não encerra
  IF NOT FOUND OR l.settled_at IS NOT NULL OR l.cancelled_at IS NOT NULL OR clock_timestamp() < l.ends_at THEN
    RETURN FALSE;
  END IF;

  IF l.leader_id IS NOT NULL THEN
    PERFORM 1 FROM wallets WHERE user_id IN (l.leader_id, l.seller_id) ORDER BY user_id FOR UPDATE;
    -- vencedor: sai do saldo e da reserva ao mesmo tempo
    UPDATE wallets SET balance_cents = balance_cents - l.current_bid_cents,
                       committed_cents = committed_cents - l.current_bid_cents
     WHERE user_id = l.leader_id;
    UPDATE wallets SET balance_cents = balance_cents + l.current_bid_cents WHERE user_id = l.seller_id;
    INSERT INTO wallet_entries (user_id, kind, amount_cents, lot_id, idempotency_key) VALUES
      (l.leader_id, 'SETTLEMENT_DEBIT', -l.current_bid_cents, l.id, 'settle:' || l.id || ':debit'),
      (l.seller_id, 'SETTLEMENT_CREDIT', l.current_bid_cents, l.id, 'settle:' || l.id || ':credit');
  END IF;

  INSERT INTO settlements (lot_id, winner_id, seller_id, amount_cents, final_bid_seq, final_hash)
  VALUES (l.id, l.leader_id, l.seller_id, l.current_bid_cents, NULLIF(l.bid_count, 0),
          CASE WHEN l.bid_count > 0 THEN l.last_hash END);
  UPDATE lots SET settled_at = clock_timestamp() WHERE id = l.id;
  RETURN TRUE;
END $$;

-- Liquida todos os lotes vencidos. Chamada pelo pg_cron (produção) e pela API (rede de segurança).
CREATE FUNCTION settle_due_lots() RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  n INT := 0;
  v_lot BIGINT;
BEGIN
  FOR v_lot IN
    SELECT id FROM lots
     WHERE settled_at IS NULL AND cancelled_at IS NULL AND ends_at <= clock_timestamp()
     ORDER BY ends_at LIMIT 200
  LOOP
    IF settle_lot(v_lot) THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;

-- Agendamento: só onde pg_cron existe (Supabase). Localmente a API roda um intervalo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('settle-due-lots', '30 seconds', 'SELECT settle_due_lots()');
  END IF;
END $$;
