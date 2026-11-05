import { randomUUID } from 'node:crypto';
import { PaperRepository } from '../lib/db/paper-repository';
import { getDbPool } from '../lib/db/client';
import { applyDisposableRuntimeDatabase, formatDisposableDatabaseError } from './disposable-database.mjs';

async function main() {
  applyDisposableRuntimeDatabase(process.env);
  const repository = new PaperRepository();
  const existingAccountId = process.env.READ_ACCOUNT_ID;
  if (existingAccountId) {
    try {
      const state = await repository.readState(existingAccountId);
      console.log(JSON.stringify({ accountId: existingAccountId, restartedProcess: true, positions: state.positions.length, closedTrades: state.closedTrades.length }));
    } finally { await repository.close(); }
    return;
  }
  const accountId = randomUUID();
  const strategyId = randomUUID();
  const entryOrderId = randomUUID();
  const exitOrderId = randomUUID();
  const entryFillId = randomUUID();
  const exitFillId = randomUUID();
  const nowMs = Date.now();
  const trade = { id: randomUUID(), accountId, strategyId, pairId: 'btcidr', entryFillId, exitFillId, baseAmount: '0.000001', entryPrice: '1', exitPrice: '1', pnlQuote: '0', pnlR: '0', closedAtMs: nowMs, idempotencyKey: `restart-proof:${accountId}` };
  try {
    await getDbPool().query('INSERT INTO virtual_accounts (id,name,initial_idr,cash_idr) VALUES ($1,$2,$3,$3)', [accountId, 'restart proof', '100']);
    await getDbPool().query('INSERT INTO strategies (id,slug,version,status,config_json) VALUES ($1,$2,$3,$4,$5::jsonb)', [strategyId, `restart-proof-${accountId}`, '1.0.0', 'paper_test', '{}']);
    for (const [orderId, fillId, side] of [[entryOrderId, entryFillId, 'buy'], [exitOrderId, exitFillId, 'sell']] as const) {
      await getDbPool().query(`INSERT INTO paper_orders (id,account_id,strategy_id,pair_id,side,order_type,requested_base,status,idempotency_key) VALUES ($1,$2,$3,'btcidr',$4,'market','0.000001','filled',$5)`, [orderId, accountId, strategyId, side, `${side}:${accountId}`]);
      await getDbPool().query(`INSERT INTO paper_fills (id,order_id,event_id,base_amount,quote_amount,average_price,fee_amount,tax_amount,slippage_bps,source,filled_at) VALUES ($1,$2,$3,'0.000001','1','1','0','0','0','rest-orderbook',now())`, [fillId, orderId, `event:${fillId}`]);
    }
    await repository.upsertPosition({ accountId, strategyId, pairId: 'btcidr', baseAmount: '0.000001', averageEntry: '1' });
    const first = await repository.recordClosedTrade(trade);
    const duplicate = await repository.recordClosedTrade(trade);
    const state = await repository.readState(accountId);
    console.log(JSON.stringify({ accountId, first, duplicate, positions: state.positions.length, closedTrades: state.closedTrades.length }));
  } finally { await repository.close(); }
}

void main().catch((error) => {
  console.error(formatDisposableDatabaseError(error, 'DB restart proof failed.'));
  process.exitCode = 1;
});
