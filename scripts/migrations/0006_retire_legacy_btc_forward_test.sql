-- Retire the legacy BTC-only campaign. Evidence remains immutable for audit.
UPDATE forward_test_runs
SET status = 'invalidated',
    last_error = 'Campaign lama BTCIDR dihentikan; scanner multi-pair menjadi campaign aktif.',
    completed_at = COALESCE(completed_at, now()),
    updated_at = now()
WHERE campaign_key = 'forward:v1:trend-following:btcidr:60'
  AND status IN ('running', 'paused');
