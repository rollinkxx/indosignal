ALTER TABLE paper_fills ADD COLUMN IF NOT EXISTS id UUID;
UPDATE paper_fills SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE paper_fills ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE paper_fills ALTER COLUMN id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS paper_fills_id_uidx ON paper_fills (id);

ALTER TABLE positions ADD COLUMN IF NOT EXISTS entry_fill_id UUID;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS entry_fee NUMERIC(36,18) NOT NULL DEFAULT 0;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS entry_tax NUMERIC(36,18) NOT NULL DEFAULT 0;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS risk_budget NUMERIC(36,18) NOT NULL DEFAULT 0;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS entry_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS forward_test_runs (
  id UUID PRIMARY KEY,
  campaign_key VARCHAR(180) NOT NULL UNIQUE,
  account_id UUID NOT NULL REFERENCES virtual_accounts(id),
  strategy_id UUID NOT NULL REFERENCES strategies(id),
  strategy_slug VARCHAR(120) NOT NULL,
  strategy_version VARCHAR(32) NOT NULL,
  pair_id VARCHAR(64) NOT NULL,
  timeframe VARCHAR(12) NOT NULL,
  status VARCHAR(24) NOT NULL CHECK (status IN ('running','paused','invalidated','completed')),
  started_at TIMESTAMPTZ NOT NULL,
  first_observed_close_ms BIGINT,
  last_processed_close_ms BIGINT NOT NULL DEFAULT 0,
  last_heartbeat_at TIMESTAMPTZ,
  observed_candles INTEGER NOT NULL DEFAULT 0 CHECK (observed_candles >= 0),
  gap_count INTEGER NOT NULL DEFAULT 0 CHECK (gap_count >= 0),
  initial_equity NUMERIC(36,18) NOT NULL,
  current_equity NUMERIC(36,18) NOT NULL,
  last_error TEXT,
  config_json JSONB NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forward_test_runs_status_idx ON forward_test_runs (status, last_heartbeat_at DESC);

CREATE TABLE IF NOT EXISTS forward_test_candles (
  run_id UUID NOT NULL REFERENCES forward_test_runs(id),
  pair_id VARCHAR(64) NOT NULL,
  timeframe VARCHAR(12) NOT NULL,
  open_time_ms BIGINT NOT NULL,
  close_time_ms BIGINT NOT NULL,
  open_price NUMERIC(36,18) NOT NULL,
  high_price NUMERIC(36,18) NOT NULL,
  low_price NUMERIC(36,18) NOT NULL,
  close_price NUMERIC(36,18) NOT NULL,
  volume_base NUMERIC(36,18) NOT NULL,
  source VARCHAR(32) NOT NULL CHECK (source = 'history_v2'),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, pair_id, timeframe, close_time_ms),
  CHECK (close_time_ms > open_time_ms),
  CHECK (high_price >= low_price)
);
CREATE INDEX IF NOT EXISTS forward_test_candles_period_idx ON forward_test_candles (run_id, close_time_ms);

CREATE TABLE IF NOT EXISTS forward_test_events (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES forward_test_runs(id),
  idempotency_key VARCHAR(220) NOT NULL,
  event_kind VARCHAR(32) NOT NULL CHECK (event_kind IN ('run_started','candle_observed','decision','order_created','fill','risk_block','position_opened','position_closed','stop_triggered','gap_detected','run_invalidated')),
  source_event_time_ms BIGINT,
  occurred_at_ms BIGINT NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS forward_test_events_period_idx ON forward_test_events (run_id, occurred_at_ms);

CREATE TABLE IF NOT EXISTS paper_cash_ledger (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES forward_test_runs(id),
  account_id UUID NOT NULL REFERENCES virtual_accounts(id),
  idempotency_key VARCHAR(220) NOT NULL,
  event_kind VARCHAR(24) NOT NULL CHECK (event_kind IN ('virtual_deposit','buy_fill','sell_fill','fee_adjustment')),
  currency VARCHAR(8) NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
  delta_cash NUMERIC(36,18) NOT NULL,
  balance_after NUMERIC(36,18) NOT NULL CHECK (balance_after >= 0),
  source_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS paper_cash_ledger_account_idx ON paper_cash_ledger (account_id, created_at);

CREATE OR REPLACE FUNCTION prevent_forward_test_append_only_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only forward-test evidence cannot be updated or deleted';
END;
$$;
DROP TRIGGER IF EXISTS forward_test_events_append_only ON forward_test_events;
CREATE TRIGGER forward_test_events_append_only BEFORE UPDATE OR DELETE ON forward_test_events
  FOR EACH ROW EXECUTE FUNCTION prevent_forward_test_append_only_mutation();
DROP TRIGGER IF EXISTS forward_test_candles_append_only ON forward_test_candles;
CREATE TRIGGER forward_test_candles_append_only BEFORE UPDATE OR DELETE ON forward_test_candles
  FOR EACH ROW EXECUTE FUNCTION prevent_forward_test_append_only_mutation();
DROP TRIGGER IF EXISTS paper_cash_ledger_append_only ON paper_cash_ledger;
CREATE TRIGGER paper_cash_ledger_append_only BEFORE UPDATE OR DELETE ON paper_cash_ledger
  FOR EACH ROW EXECUTE FUNCTION prevent_forward_test_append_only_mutation();
