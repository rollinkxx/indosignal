CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) NOT NULL PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS virtual_accounts (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  initial_idr DECIMAL(36,18) NOT NULL,
  cash_idr DECIMAL(36,18) NOT NULL,
  status ENUM('active','paused','disabled') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS strategies (
  id CHAR(36) NOT NULL PRIMARY KEY,
  slug VARCHAR(120) NOT NULL,
  version VARCHAR(32) NOT NULL,
  status ENUM('draft','backtest_required','paper_test','active','disabled') NOT NULL DEFAULT 'draft',
  config_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY strategies_slug_version (slug, version)
);

CREATE TABLE IF NOT EXISTS candles (
  pair_id VARCHAR(64) NOT NULL,
  timeframe VARCHAR(12) NOT NULL,
  open_time_ms BIGINT NOT NULL,
  close_time_ms BIGINT NOT NULL,
  open_price DECIMAL(36,18) NOT NULL,
  high_price DECIMAL(36,18) NOT NULL,
  low_price DECIMAL(36,18) NOT NULL,
  close_price DECIMAL(36,18) NOT NULL,
  volume_base DECIMAL(36,18) NOT NULL,
  source VARCHAR(32) NOT NULL,
  PRIMARY KEY (pair_id, timeframe, open_time_ms),
  KEY candles_close_idx (pair_id, timeframe, close_time_ms)
);

CREATE TABLE IF NOT EXISTS paper_orders (
  id CHAR(36) NOT NULL PRIMARY KEY,
  account_id CHAR(36) NOT NULL,
  strategy_id CHAR(36) NOT NULL,
  pair_id VARCHAR(64) NOT NULL,
  side ENUM('buy','sell') NOT NULL,
  order_type ENUM('market','limit') NOT NULL,
  requested_base DECIMAL(36,18) NOT NULL,
  limit_price DECIMAL(36,18) NULL,
  status ENUM('open','partially_filled','filled','cancelled','rejected') NOT NULL,
  idempotency_key VARCHAR(180) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY paper_orders_idempotency (idempotency_key),
  KEY paper_orders_account_idx (account_id, created_at)
);

CREATE TABLE IF NOT EXISTS paper_fills (
  id CHAR(36) NOT NULL PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  event_id VARCHAR(180) NOT NULL,
  base_amount DECIMAL(36,18) NOT NULL,
  quote_amount DECIMAL(36,18) NOT NULL,
  average_price DECIMAL(36,18) NOT NULL,
  fee_amount DECIMAL(36,18) NOT NULL,
  tax_amount DECIMAL(36,18) NOT NULL,
  slippage_bps DECIMAL(18,8) NOT NULL,
  source VARCHAR(32) NOT NULL,
  filled_at TIMESTAMP(3) NOT NULL,
  UNIQUE KEY paper_fills_event (order_id, event_id),
  KEY paper_fills_order_idx (order_id, filled_at)
);

CREATE TABLE IF NOT EXISTS decision_log (
  id CHAR(36) NOT NULL PRIMARY KEY,
  account_id CHAR(36) NOT NULL,
  strategy_id CHAR(36) NOT NULL,
  pair_id VARCHAR(64) NOT NULL,
  candle_close_time_ms BIGINT NOT NULL,
  action VARCHAR(32) NOT NULL,
  reason_json JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY decision_idempotency (strategy_id, pair_id, candle_close_time_ms)
);

CREATE TABLE IF NOT EXISTS fee_configs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  source_url VARCHAR(512) NOT NULL,
  source_published_at DATE NULL,
  effective_from TIMESTAMP NOT NULL,
  maker_rate DECIMAL(18,12) NOT NULL,
  taker_rate DECIMAL(18,12) NOT NULL,
  tax_rate DECIMAL(18,12) NOT NULL,
  assumptions_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY fee_configs_effective_idx (effective_from)
);
