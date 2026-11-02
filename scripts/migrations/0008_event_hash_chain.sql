CREATE TABLE IF NOT EXISTS forward_test_event_chain (
  run_id UUID NOT NULL REFERENCES forward_test_runs(id),
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  event_id UUID NOT NULL UNIQUE REFERENCES forward_test_events(id),
  idempotency_key VARCHAR(220) NOT NULL,
  previous_hash CHAR(64) NOT NULL CHECK (previous_hash ~ '^[a-f0-9]{64}$'),
  event_hash CHAR(64) NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  canonical_event TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, sequence),
  UNIQUE (run_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS forward_test_event_chain_run_idx ON forward_test_event_chain (run_id, sequence DESC);

CREATE OR REPLACE FUNCTION prevent_forward_test_chain_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'forward-test audit hash chain is append-only';
END;
$$;
DROP TRIGGER IF EXISTS forward_test_event_chain_append_only ON forward_test_event_chain;
CREATE TRIGGER forward_test_event_chain_append_only BEFORE UPDATE OR DELETE ON forward_test_event_chain
  FOR EACH ROW EXECUTE FUNCTION prevent_forward_test_chain_mutation();
