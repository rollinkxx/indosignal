export type IntegrityInput = {
  unvalidatedConstraints?: unknown[];
  orphanChecks?: Array<{ count?: number | string }>;
  ledger?: { mismatches?: number | string };
  duplicateIdempotency?: Array<{ duplicate_groups?: number | string }>;
  chain?: { missing?: number | string; orphan?: number | string; mismatch?: number | string };
};
export function summarizeIntegrity(input?: IntegrityInput): {
  ok: boolean;
  checks: Record<string, boolean>;
  status: Record<string, string>;
  totals: Record<string, number>;
};
