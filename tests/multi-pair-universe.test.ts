import { describe, expect, it } from 'vitest';
import type { Pair } from '../lib/indodax/schemas';
import type { MarketSnapshot } from '../lib/indodax/normalize';
import { selectMultiPairUniverse } from '../lib/forward-test/multi-pair-universe';

const now = 1_800_000_000_000;
function pair(id: string, extra: Partial<Pair> = {}): Pair {
  return {
    id, symbol: id.toUpperCase(), ticker_id: `${id.toUpperCase()}_IDR`,
    base_currency: 'idr', traded_currency: id.replace(/idr$/i, ''),
    trade_fee_percent_taker: '0.3', trade_fee_percent_maker: '0.2',
    ...extra,
  };
}
function market(pairId: string, overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    pairId, tickerId: `${pairId.toUpperCase()}_IDR`, symbol: pairId.toUpperCase(),
    last: '100', buy: '99.9', sell: '100.1', high24h: '110', low24h: '90',
    volumeIdr24h: '500000000', updatedAtMs: now, source: 'rest', status: 'live',
    ...overrides,
  };
}

describe('multi-pair universe selection', () => {
  it('keeps only live, liquid, tight-spread, unsuspended IDR pairs with fee metadata', () => {
    const markets = [
      market('btcidr'),
      market('ethidr', { status: 'stale' }),
      market('xrpidr', { buy: '90', sell: '110' }),
      market('dogeidr', { volumeIdr24h: '99999999' }),
      market('adaidr'),
      market('usdtidr'),
    ];
    const pairs = [
      pair('btcidr'),
      pair('ethidr'),
      pair('xrpidr'),
      pair('dogeidr'),
      pair('adaidr', { is_market_suspended: true }),
      pair('usdtidr', { trade_fee_percent_taker: undefined }),
    ];
    expect(selectMultiPairUniverse(markets, pairs, now).map((item) => item.pairId)).toEqual(['btcidr']);
  });

  it('keeps eligible BTCIDR as the baseline while capping the frozen universe size', () => {
    const markets = [market('btcidr', { volumeIdr24h: '200000000' }), market('ethidr', { volumeIdr24h: '900000000' })];
    expect(selectMultiPairUniverse(markets, [pair('btcidr'), pair('ethidr')], now, 1).map((item) => item.pairId)).toEqual(['btcidr']);
    expect(selectMultiPairUniverse(markets, [pair('btcidr'), pair('ethidr')], now, 2).map((item) => item.pairId)).toEqual(['btcidr', 'ethidr']);
  });

  it('accepts explicitly reported zero fee as valid fee metadata', () => {
    const freeFeePair = pair('btcidr', { trade_fee_percent_taker: '0', trade_fee_percent_maker: '0' });
    const selected = selectMultiPairUniverse([market('btcidr')], [freeFeePair], now);
    expect(selected).toHaveLength(1);
    expect(selected[0].takerFeePercent).toBe('0');
  });
});
