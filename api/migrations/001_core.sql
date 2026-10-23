-- Valores monetários em centavos (BIGINT). Horários em timestamptz (UTC).

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('AUCTIONEER', 'BIDDER')),
  display_name  TEXT NOT NULL,
  -- pseudônimo público: único dado do usuário exibido em auditoria e comprovantes
  public_alias  TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Saldo materializado; o CHECK é a última barreira contra saldo negativo/reserva maior que saldo.
CREATE TABLE wallets (
  user_id         BIGINT PRIMARY KEY REFERENCES users(id),
  balance_cents   BIGINT NOT NULL DEFAULT 0,
  committed_cents BIGINT NOT NULL DEFAULT 0,
  CHECK (committed_cents >= 0 AND committed_cents <= balance_cents)
);

-- Livro-razão imutável; idempotency_key impede lançamento duplicado.
CREATE TABLE wallet_entries (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id),
  kind            TEXT NOT NULL CHECK (kind IN ('DEPOSIT', 'SETTLEMENT_DEBIT', 'SETTLEMENT_CREDIT')),
  amount_cents    BIGINT NOT NULL CHECK (amount_cents <> 0),
  lot_id          BIGINT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX wallet_entries_user_idx ON wallet_entries (user_id, created_at DESC);

-- Cópia local do item da API externa: lote não depende mais da API depois de criado.
CREATE TABLE item_snapshots (
  id           BIGSERIAL PRIMARY KEY,
  source       TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  title        TEXT NOT NULL,
  attributes   JSONB NOT NULL DEFAULT '{}',
  image_bytes  BYTEA,
  image_mime   TEXT,
  source_url   TEXT,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Estado (agendado/ao vivo/encerrado/cancelado) é derivado de horários + cancelled_at, nunca gravado.
CREATE TABLE lots (
  id                   BIGSERIAL PRIMARY KEY,
  seller_id            BIGINT NOT NULL REFERENCES users(id),
  item_snapshot_id     BIGINT NOT NULL REFERENCES item_snapshots(id),
  starting_price_cents BIGINT NOT NULL CHECK (starting_price_cents > 0),
  min_increment_cents  BIGINT NOT NULL CHECK (min_increment_cents > 0),
  starts_at            TIMESTAMPTZ NOT NULL,
  ends_at              TIMESTAMPTZ NOT NULL,
  original_ends_at     TIMESTAMPTZ NOT NULL,
  cancelled_at         TIMESTAMPTZ,
  -- liderança denormalizada, atualizada na mesma transação do lance (sob FOR UPDATE do lote)
  leader_id            BIGINT REFERENCES users(id),
  current_bid_cents    BIGINT,
  bid_count            INT NOT NULL DEFAULT 0,
  last_hash            TEXT NOT NULL DEFAULT repeat('0', 64),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (cancelled_at IS NULL OR bid_count = 0)
);
CREATE INDEX lots_ends_at_idx ON lots (ends_at) WHERE cancelled_at IS NULL;

-- Histórico de lances: encadeado por hash (prev_hash -> hash), seq contínua por lote.
CREATE TABLE bids (
  id           BIGSERIAL PRIMARY KEY,
  lot_id       BIGINT NOT NULL REFERENCES lots(id),
  seq          INT NOT NULL,
  bidder_id    BIGINT NOT NULL REFERENCES users(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  created_at   TIMESTAMPTZ NOT NULL,
  prev_hash    TEXT NOT NULL,
  hash         TEXT NOT NULL,
  UNIQUE (lot_id, seq)
);
CREATE INDEX bids_bidder_idx ON bids (bidder_id);
