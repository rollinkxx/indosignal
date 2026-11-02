import type { PoolClient } from 'pg';
import { getDbPool } from './client';
export type PositionRecord = { accountId: string; strategyId: string; pairId: string; baseAmount: string; averageEntry: string; stopPrice?: string | null; realizedPnl?: string };
export type ClosedTradeRecord = { id: string; accountId: string; strategyId: string; pairId: string; entryFillId: string; exitFillId: string; baseAmount: string; entryPrice: string; exitPrice: string; pnlQuote: string; pnlR: string; closedAtMs: number; idempotencyKey: string };
export class PaperRepository {
  async upsertPosition(position: PositionRecord): Promise<void> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO positions (account_id, strategy_id, pair_id, base_amount, average_entry, stop_price, realized_pnl) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (account_id, strategy_id, pair_id) DO UPDATE SET base_amount=EXCLUDED.base_amount, average_entry=EXCLUDED.average_entry, stop_price=EXCLUDED.stop_price, realized_pnl=EXCLUDED.realized_pnl, updated_at=now()`, [position.accountId, position.strategyId, position.pairId, position.baseAmount, position.averageEntry, position.stopPrice ?? null, position.realizedPnl ?? '0']);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async recordClosedTrade(trade: ClosedTradeRecord): Promise<{ inserted: boolean }> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`INSERT INTO closed_trades (id, account_id, strategy_id, pair_id, entry_fill_id, exit_fill_id, base_amount, entry_price, exit_price, pnl_quote, pnl_r, closed_at, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, to_timestamp($12::double precision / 1000), $13) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`, [trade.id, trade.accountId, trade.strategyId, trade.pairId, trade.entryFillId, trade.exitFillId, trade.baseAmount, trade.entryPrice, trade.exitPrice, trade.pnlQuote, trade.pnlR, trade.closedAtMs, trade.idempotencyKey]);
      await client.query('COMMIT');
      return { inserted: (result.rowCount ?? 0) === 1 };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async readState(accountId: string): Promise<{ positions: unknown[]; closedTrades: unknown[] }> {
    const client = await getDbPool().connect();
    try {
      const positions = await client.query('SELECT account_id, strategy_id, pair_id, base_amount, average_entry, stop_price, realized_pnl FROM positions WHERE account_id = $1 ORDER BY pair_id', [accountId]);
      const closedTrades = await client.query('SELECT id, account_id, strategy_id, pair_id, base_amount, entry_price, exit_price, pnl_quote, pnl_r, closed_at, idempotency_key FROM closed_trades WHERE account_id = $1 ORDER BY closed_at', [accountId]);
      return { positions: positions.rows, closedTrades: closedTrades.rows };
    } finally { client.release(); }
  }
  async ping(): Promise<boolean> {
    const client: PoolClient = await getDbPool().connect();
    try { await client.query('SELECT 1'); return true; } finally { client.release(); }
  }
  async close(): Promise<void> { await getDbPool().end(); }
}
