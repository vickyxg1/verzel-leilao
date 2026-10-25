-- Cancelamento com estorno automático (opcional do edital, p. 6).
-- Lote com lances passa a poder ser cancelado antes da liquidação; a reserva do líder volta ao disponível.

-- remove o CHECK que proibia cancelar lote com lances (constraint sem nome em 001_core.sql)
DO $$
DECLARE c TEXT;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'lots'::regclass AND pg_get_constraintdef(oid) LIKE '%cancelled_at IS NULL%bid_count = 0%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE lots DROP CONSTRAINT %I', c); END IF;
END $$;

-- lote liquidado não pode mais ser cancelado
ALTER TABLE lots ADD CONSTRAINT lots_cancel_before_settle CHECK (cancelled_at IS NULL OR settled_at IS NULL);

-- CANCEL_RELEASE: reserva devolvida ao disponível. Não altera balance_cents (o valor nunca saiu do saldo,
-- só estava comprometido); fica no extrato para o licitante ver o estorno.
ALTER TABLE wallet_entries DROP CONSTRAINT wallet_entries_kind_check;
ALTER TABLE wallet_entries ADD CONSTRAINT wallet_entries_kind_check
  CHECK (kind IN ('DEPOSIT', 'SETTLEMENT_DEBIT', 'SETTLEMENT_CREDIT', 'CANCEL_RELEASE'));
