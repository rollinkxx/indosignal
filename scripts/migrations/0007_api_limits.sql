CREATE TABLE IF NOT EXISTS api_rate_limit_buckets (
  bucket_key VARCHAR(128) PRIMARY KEY,
  window_start_ms BIGINT NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 0),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS api_rate_limit_buckets_expiry_idx ON api_rate_limit_buckets (expires_at);

CREATE TABLE IF NOT EXISTS api_request_leases (
  id UUID PRIMARY KEY,
  endpoint VARCHAR(80) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS api_request_leases_endpoint_expiry_idx ON api_request_leases (endpoint, expires_at);
