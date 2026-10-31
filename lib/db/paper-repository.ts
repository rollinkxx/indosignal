import type { PoolConnection } from 'mysql2/promise';
import { getDbPool } from './client';

export type PositionRecord = { accountId: string; strategyId: string; pairId: string; baseAmount: string; averageEntry: string; stopPrice?: string | null; realizedPnl?: string };
export type ClosedTradeRecord = { id: string; accountId: string; strategyId: string; pairId: string; entryFillId: string; exitFillId: string; baseAmount: string; entryPrice: string; exitPrice: string; pnlQuote: string; pnlR: string; closedAtMs: number; idempotencyKey: string };

export class PaperRepository {
  async upsertPosition(position: PositionRecord): Promise<void> {
    const connection = await getDbPool().getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(`INSERT INTO positions (account_id, strategy_id, pair_id, base_amount, average_entry, stop_price, realized_pnl) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE base_amount=VALUES(base_amount), average_entry=VALUES(average_entry), stop_price=VALUES(stop_price), realized_pnl=VALUES(realized_pnl)`, [position.accountId, position.strategyId, position.pairId, position.baseAmount, position.averageEntry, position.stopPrice ?? null, position.realizedPnl ?? '0']);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async recordClosedTrade(trade: ClosedTradeRecord): Promise<{ inserted: boolean }> {
    const connection = await getDbPool().getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute(`INSERT IGNORE INTO closed_trades (id, account_id, strategy_id, pair_id, entry_fill_id, exit_fill_id, base_amount, entry_price, exit_price, pnl_quote, pnl_r, closed_at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FROM_UNIXTIME(? / 1000), ?)`, [trade.id, trade.accountId, trade.strategyId, trade.pairId, trade.entryFillId, trade.exitFillId, trade.baseAmount, trade.entryPrice, trade.exitPrice, trade.pnlQuote, trade.pnlR, trade.closedAtMs, trade.idempotencyKey]);
      await connection.commit();
      return { inserted: (result as { affectedRows?: number }).affectedRows === 1 };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async readState(accountId: string): Promise<{ positions: unknown[]; closedTrades: unknown[] }> {
    const connection = await getDbPool().getConnection();
    try {
      const [positions] = await connection.execute('SELECT account_id, strategy_id, pair_id, base_amount, average_entry, stop_price, realized_pnl FROM positions WHERE account_id = ? ORDER BY pair_id', [accountId]);
      const [closedTrades] = await connection.execute('SELECT id, account_id, strategy_id, pair_id, base_amount, entry_price, exit_price, pnl_quote, pnl_r, closed_at, idempotency_key FROM closed_trades WHERE account_id = ? ORDER BY closed_at', [accountId]);
      return { positions: positions as unknown[], closedTrades: closedTrades as unknown[] };
    } finally { connection.release(); }
  }

  async ping(): Promise<boolean> {
    const connection: PoolConnection = await getDbPool().getConnection();
    try { await connection.query('SELECT 1'); return true; } finally { connection.release(); }
  }

  async close(): Promise<void> { await getDbPool().end(); }
}
