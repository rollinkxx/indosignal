DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='paper_orders_account_fk') THEN
    ALTER TABLE paper_orders ADD CONSTRAINT paper_orders_account_fk FOREIGN KEY (account_id) REFERENCES virtual_accounts(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='paper_orders_strategy_fk') THEN
    ALTER TABLE paper_orders ADD CONSTRAINT paper_orders_strategy_fk FOREIGN KEY (strategy_id) REFERENCES strategies(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='paper_fills_order_fk') THEN
    ALTER TABLE paper_fills ADD CONSTRAINT paper_fills_order_fk FOREIGN KEY (order_id) REFERENCES paper_orders(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='positions_account_fk') THEN
    ALTER TABLE positions ADD CONSTRAINT positions_account_fk FOREIGN KEY (account_id) REFERENCES virtual_accounts(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='positions_strategy_fk') THEN
    ALTER TABLE positions ADD CONSTRAINT positions_strategy_fk FOREIGN KEY (strategy_id) REFERENCES strategies(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='closed_trades_account_fk') THEN
    ALTER TABLE closed_trades ADD CONSTRAINT closed_trades_account_fk FOREIGN KEY (account_id) REFERENCES virtual_accounts(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='closed_trades_strategy_fk') THEN
    ALTER TABLE closed_trades ADD CONSTRAINT closed_trades_strategy_fk FOREIGN KEY (strategy_id) REFERENCES strategies(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='closed_trades_entry_fill_fk') THEN
    ALTER TABLE closed_trades ADD CONSTRAINT closed_trades_entry_fill_fk FOREIGN KEY (entry_fill_id) REFERENCES paper_fills(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='closed_trades_exit_fill_fk') THEN
    ALTER TABLE closed_trades ADD CONSTRAINT closed_trades_exit_fill_fk FOREIGN KEY (exit_fill_id) REFERENCES paper_fills(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='decision_log_account_fk') THEN
    ALTER TABLE decision_log ADD CONSTRAINT decision_log_account_fk FOREIGN KEY (account_id) REFERENCES virtual_accounts(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='decision_log_strategy_fk') THEN
    ALTER TABLE decision_log ADD CONSTRAINT decision_log_strategy_fk FOREIGN KEY (strategy_id) REFERENCES strategies(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='paper_orders_positive_quantity_check') THEN
    ALTER TABLE paper_orders ADD CONSTRAINT paper_orders_positive_quantity_check CHECK (requested_base > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='paper_fills_positive_amount_check') THEN
    ALTER TABLE paper_fills ADD CONSTRAINT paper_fills_positive_amount_check CHECK (base_amount > 0 AND quote_amount > 0 AND average_price > 0 AND fee_amount >= 0 AND tax_amount >= 0) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS paper_orders_open_idx ON paper_orders (account_id, created_at DESC) WHERE status IN ('open','partially_filled');
CREATE INDEX IF NOT EXISTS forward_test_event_chain_tail_idx ON forward_test_event_chain (run_id, sequence DESC);
CREATE INDEX IF NOT EXISTS paper_cash_ledger_run_time_idx ON paper_cash_ledger (run_id, created_at, id);

CREATE OR REPLACE FUNCTION prevent_forward_test_evidence_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only forward-test evidence cannot be truncated';
END;
$$;
DROP TRIGGER IF EXISTS forward_test_events_no_truncate ON forward_test_events;
CREATE TRIGGER forward_test_events_no_truncate BEFORE TRUNCATE ON forward_test_events FOR EACH STATEMENT EXECUTE FUNCTION prevent_forward_test_evidence_truncate();
DROP TRIGGER IF EXISTS forward_test_candles_no_truncate ON forward_test_candles;
CREATE TRIGGER forward_test_candles_no_truncate BEFORE TRUNCATE ON forward_test_candles FOR EACH STATEMENT EXECUTE FUNCTION prevent_forward_test_evidence_truncate();
DROP TRIGGER IF EXISTS paper_cash_ledger_no_truncate ON paper_cash_ledger;
CREATE TRIGGER paper_cash_ledger_no_truncate BEFORE TRUNCATE ON paper_cash_ledger FOR EACH STATEMENT EXECUTE FUNCTION prevent_forward_test_evidence_truncate();
DROP TRIGGER IF EXISTS forward_test_event_chain_no_truncate ON forward_test_event_chain;
CREATE TRIGGER forward_test_event_chain_no_truncate BEFORE TRUNCATE ON forward_test_event_chain FOR EACH STATEMENT EXECUTE FUNCTION prevent_forward_test_evidence_truncate();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM paper_orders o LEFT JOIN virtual_accounts a ON a.id=o.account_id WHERE a.id IS NULL)
    AND NOT EXISTS (SELECT 1 FROM paper_orders o LEFT JOIN strategies s ON s.id=o.strategy_id WHERE s.id IS NULL)
    THEN ALTER TABLE paper_orders VALIDATE CONSTRAINT paper_orders_account_fk; ALTER TABLE paper_orders VALIDATE CONSTRAINT paper_orders_strategy_fk; END IF;
  IF NOT EXISTS (SELECT 1 FROM paper_fills f LEFT JOIN paper_orders o ON o.id=f.order_id WHERE o.id IS NULL)
    THEN ALTER TABLE paper_fills VALIDATE CONSTRAINT paper_fills_order_fk; END IF;
  IF NOT EXISTS (SELECT 1 FROM positions p LEFT JOIN virtual_accounts a ON a.id=p.account_id WHERE a.id IS NULL)
    AND NOT EXISTS (SELECT 1 FROM positions p LEFT JOIN strategies s ON s.id=p.strategy_id WHERE s.id IS NULL)
    THEN ALTER TABLE positions VALIDATE CONSTRAINT positions_account_fk; ALTER TABLE positions VALIDATE CONSTRAINT positions_strategy_fk; END IF;
  IF NOT EXISTS (SELECT 1 FROM closed_trades t LEFT JOIN virtual_accounts a ON a.id=t.account_id WHERE a.id IS NULL)
    AND NOT EXISTS (SELECT 1 FROM closed_trades t LEFT JOIN strategies s ON s.id=t.strategy_id WHERE s.id IS NULL)
    THEN ALTER TABLE closed_trades VALIDATE CONSTRAINT closed_trades_account_fk; ALTER TABLE closed_trades VALIDATE CONSTRAINT closed_trades_strategy_fk; END IF;
  IF NOT EXISTS (SELECT 1 FROM closed_trades t LEFT JOIN paper_fills f ON f.id=t.entry_fill_id WHERE f.id IS NULL)
    THEN ALTER TABLE closed_trades VALIDATE CONSTRAINT closed_trades_entry_fill_fk; END IF;
  IF NOT EXISTS (SELECT 1 FROM closed_trades t LEFT JOIN paper_fills f ON f.id=t.exit_fill_id WHERE f.id IS NULL)
    THEN ALTER TABLE closed_trades VALIDATE CONSTRAINT closed_trades_exit_fill_fk; END IF;
  IF NOT EXISTS (SELECT 1 FROM decision_log d LEFT JOIN virtual_accounts a ON a.id=d.account_id WHERE a.id IS NULL)
    AND NOT EXISTS (SELECT 1 FROM decision_log d LEFT JOIN strategies s ON s.id=d.strategy_id WHERE s.id IS NULL)
    THEN ALTER TABLE decision_log VALIDATE CONSTRAINT decision_log_account_fk; ALTER TABLE decision_log VALIDATE CONSTRAINT decision_log_strategy_fk; END IF;
  IF NOT EXISTS (SELECT 1 FROM paper_orders WHERE requested_base <= 0) THEN ALTER TABLE paper_orders VALIDATE CONSTRAINT paper_orders_positive_quantity_check; END IF;
  IF NOT EXISTS (SELECT 1 FROM paper_fills WHERE base_amount <= 0 OR quote_amount <= 0 OR average_price <= 0 OR fee_amount < 0 OR tax_amount < 0) THEN ALTER TABLE paper_fills VALIDATE CONSTRAINT paper_fills_positive_amount_check; END IF;
END $$;
