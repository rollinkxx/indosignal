CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(64) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS virtual_accounts (
 id UUID PRIMARY KEY, name VARCHAR(120) NOT NULL, initial_idr NUMERIC(36,18) NOT NULL, cash_idr NUMERIC(36,18) NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','disabled')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS strategies (
 id UUID PRIMARY KEY, slug VARCHAR(120) NOT NULL, version VARCHAR(32) NOT NULL,
 status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','backtest_required','paper_test','active','disabled')),
 config_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT strategies_slug_version UNIQUE (slug, version)
);
CREATE TABLE IF NOT EXISTS candles (
 pair_id VARCHAR(64) NOT NULL, timeframe VARCHAR(12) NOT NULL, open_time_ms BIGINT NOT NULL, close_time_ms BIGINT NOT NULL,
 open_price NUMERIC(36,18) NOT NULL, high_price NUMERIC(36,18) NOT NULL, low_price NUMERIC(36,18) NOT NULL,
 close_price NUMERIC(36,18) NOT NULL, volume_base NUMERIC(36,18) NOT NULL, source VARCHAR(32) NOT NULL,
 PRIMARY KEY (pair_id, timeframe, open_time_ms)
);
CREATE INDEX IF NOT EXISTS candles_close_idx ON candles (pair_id, timeframe, close_time_ms);
CREATE TABLE IF NOT EXISTS paper_orders (
 id UUID PRIMARY KEY, account_id UUID NOT NULL, strategy_id UUID NOT NULL, pair_id VARCHAR(64) NOT NULL,
 side VARCHAR(8) NOT NULL CHECK (side IN ('buy','sell')), order_type VARCHAR(8) NOT NULL CHECK (order_type IN ('market','limit')),
 requested_base NUMERIC(36,18) NOT NULL, limit_price NUMERIC(36,18),
 status VARCHAR(24) NOT NULL CHECK (status IN ('open','partially_filled','filled','cancelled','rejected')),
 idempotency_key VARCHAR(180) NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paper_orders_account_idx ON paper_orders (account_id, created_at);
CREATE TABLE IF NOT EXISTS paper_fills (
 id UUID PRIMARY KEY, order_id UUID NOT NULL, event_id VARCHAR(180) NOT NULL, base_amount NUMERIC(36,18) NOT NULL,
 quote_amount NUMERIC(36,18) NOT NULL, average_price NUMERIC(36,18) NOT NULL, fee_amount NUMERIC(36,18) NOT NULL,
 tax_amount NUMERIC(36,18) NOT NULL, slippage_bps NUMERIC(18,8) NOT NULL, source VARCHAR(32) NOT NULL,
 filled_at TIMESTAMPTZ NOT NULL, UNIQUE (order_id, event_id)
);
CREATE INDEX IF NOT EXISTS paper_fills_order_idx ON paper_fills (order_id, filled_at);
CREATE TABLE IF NOT EXISTS positions (
 account_id UUID NOT NULL, strategy_id UUID NOT NULL, pair_id VARCHAR(64) NOT NULL, base_amount NUMERIC(36,18) NOT NULL,
 average_entry NUMERIC(36,18) NOT NULL, stop_price NUMERIC(36,18), realized_pnl NUMERIC(36,18) NOT NULL DEFAULT 0,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (account_id, strategy_id, pair_id)
);
CREATE TABLE IF NOT EXISTS closed_trades (
 id UUID PRIMARY KEY, account_id UUID NOT NULL, strategy_id UUID NOT NULL, pair_id VARCHAR(64) NOT NULL,
 entry_fill_id UUID NOT NULL, exit_fill_id UUID NOT NULL, base_amount NUMERIC(36,18) NOT NULL,
 entry_price NUMERIC(36,18) NOT NULL, exit_price NUMERIC(36,18) NOT NULL, pnl_quote NUMERIC(36,18) NOT NULL,
 pnl_r NUMERIC(36,18) NOT NULL, closed_at TIMESTAMPTZ NOT NULL, idempotency_key VARCHAR(180) NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS closed_trades_account_idx ON closed_trades (account_id, closed_at);
CREATE TABLE IF NOT EXISTS decision_log (
 id UUID PRIMARY KEY, account_id UUID NOT NULL, strategy_id UUID NOT NULL, pair_id VARCHAR(64) NOT NULL,
 candle_close_time_ms BIGINT NOT NULL, action VARCHAR(32) NOT NULL, reason_json JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT decision_idempotency UNIQUE (strategy_id, pair_id, candle_close_time_ms)
);
CREATE TABLE IF NOT EXISTS fee_configs (
 id UUID PRIMARY KEY, pair_id VARCHAR(64), source_url VARCHAR(512) NOT NULL, source_published_at DATE,
 effective_from TIMESTAMPTZ NOT NULL, maker_rate NUMERIC(18,12) NOT NULL, taker_rate NUMERIC(18,12) NOT NULL,
 tax_buy_rate NUMERIC(18,12), tax_sell_rate NUMERIC(18,12), assumptions_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fee_configs_effective_idx ON fee_configs (pair_id, effective_from);
