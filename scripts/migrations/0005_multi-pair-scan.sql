CREATE TABLE IF NOT EXISTS multi_pair_scan_runs (
  id UUID PRIMARY KEY,
  campaign_key VARCHAR(180) NOT NULL UNIQUE,
  status VARCHAR(24) NOT NULL CHECK (status IN ('running','paused','invalidated')),
  started_at TIMESTAMPTZ NOT NULL,
  last_heartbeat_at TIMESTAMPTZ,
  universe_json JSONB NOT NULL,
  timeframe VARCHAR(12) NOT NULL DEFAULT '60',
  gap_count INTEGER NOT NULL DEFAULT 0 CHECK (gap_count >= 0),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS multi_pair_scan_observations (
  run_id UUID NOT NULL REFERENCES multi_pair_scan_runs(id),
  pair_id VARCHAR(64) NOT NULL,
  timeframe VARCHAR(12) NOT NULL,
  open_time_ms BIGINT NOT NULL,
  close_time_ms BIGINT NOT NULL,
  action VARCHAR(8) NOT NULL CHECK (action IN ('buy','sell','hold')),
  reasons_json JSONB NOT NULL,
  candle_json JSONB NOT NULL,
  market_json JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, pair_id, timeframe, close_time_ms),
  CHECK (close_time_ms > open_time_ms)
);
CREATE INDEX IF NOT EXISTS multi_pair_scan_observations_pair_time_idx
  ON multi_pair_scan_observations (run_id, pair_id, close_time_ms DESC);

CREATE OR REPLACE FUNCTION prevent_multi_pair_scan_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'multi-pair scan evidence is append-only';
END;
$$;
DROP TRIGGER IF EXISTS multi_pair_scan_observations_append_only ON multi_pair_scan_observations;
CREATE TRIGGER multi_pair_scan_observations_append_only BEFORE UPDATE OR DELETE ON multi_pair_scan_observations
  FOR EACH ROW EXECUTE FUNCTION prevent_multi_pair_scan_mutation();
