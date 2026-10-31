import { randomUUID } from 'node:crypto';
import { PaperRepository } from '../lib/db/paper-repository';

async function main() {
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
  const trade = { id: randomUUID(), accountId, strategyId: 'restart-proof-strategy', pairId: 'btcidr', entryFillId: 'restart-proof-entry', exitFillId: 'restart-proof-exit', baseAmount: '0.000001', entryPrice: '1', exitPrice: '1', pnlQuote: '0', pnlR: '0', closedAtMs: Date.now(), idempotencyKey: `restart-proof:${accountId}` };
  try {
    const first = await repository.recordClosedTrade(trade);
    const duplicate = await repository.recordClosedTrade(trade);
    const state = await repository.readState(accountId);
    console.log(JSON.stringify({ accountId, first, duplicate, positions: state.positions.length, closedTrades: state.closedTrades.length }));
  } finally { await repository.close(); }
}

void main();
