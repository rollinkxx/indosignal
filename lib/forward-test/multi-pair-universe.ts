import type { MarketSnapshot } from '@/lib/indodax/normalize';
import type { Pair } from '@/lib/indodax/schemas';
import type { MultiPairUniverse } from './multi-pair-repository';

export const MULTI_PAIR_MAX_PAIRS = 20;
export const MULTI_PAIR_MIN_VOLUME_IDR = '100000000';
export const MULTI_PAIR_MAX_SPREAD_BPS = 150;

function flagIsOn(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return value !== undefined && value !== null && ['1', 'true', 'yes'].includes(String(value).toLowerCase());
}

function finitePositive(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteNonNegative(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function selectMultiPairUniverse(
  markets: MarketSnapshot[],
  pairs: Pair[],
  nowMs = Date.now(),
  maxPairs = MULTI_PAIR_MAX_PAIRS,
): MultiPairUniverse['pairs'] {
  const pairById = new Map(pairs.map((pair) => [pair.id.toLowerCase(), pair]));
  const eligible: MultiPairUniverse['pairs'] = [];
  for (const market of markets) {
    const pair = pairById.get(market.pairId.toLowerCase());
    if (!pair || !pair.id.toLowerCase().endsWith('idr') || pair.base_currency.toLowerCase() !== 'idr') continue;
    if (market.status !== 'live' || nowMs - market.updatedAtMs > 30_000) continue;
    if (flagIsOn(pair.is_maintenance) || flagIsOn(pair.is_market_suspended)) continue;
    const volume = finitePositive(market.volumeIdr24h);
    if (volume === null || volume < Number(MULTI_PAIR_MIN_VOLUME_IDR)) continue;
    const bid = finitePositive(market.buy);
    const ask = finitePositive(market.sell);
    if (bid === null || ask === null || ask < bid) continue;
    const spreadBps = ((ask - bid) / ((ask + bid) / 2)) * 10_000;
    if (!Number.isFinite(spreadBps) || spreadBps > MULTI_PAIR_MAX_SPREAD_BPS) continue;
    const takerFee = finiteNonNegative(pair.trade_fee_percent_taker ?? pair.trade_fee_percent);
    const makerFee = finiteNonNegative(pair.trade_fee_percent_maker ?? pair.trade_fee_percent_taker ?? pair.trade_fee_percent);
    if (takerFee === null || makerFee === null || takerFee > 3 || makerFee > 3) continue;
    eligible.push({
      pairId: pair.id,
      tickerId: pair.ticker_id,
      symbol: pair.symbol,
      takerFeePercent: String(takerFee),
      makerFeePercent: String(makerFee),
      priceIncrement: finitePositive(pair.price_round) ? String(pair.price_round) : undefined,
      quantityIncrement: finitePositive(pair.quantity_increment) ? String(pair.quantity_increment) : undefined,
      minimumBase: finitePositive(pair.trade_min_base_currency) ? String(pair.trade_min_base_currency) : undefined,
      minimumQuote: finitePositive(pair.trade_min_traded_currency) ? String(pair.trade_min_traded_currency) : undefined,
      volumeIdr24h: String(volume),
      spreadBps: Number(spreadBps.toFixed(2)),
    });
  }
  const ranked = eligible.sort((a, b) => Number(b.volumeIdr24h) - Number(a.volumeIdr24h));
  const btc = ranked.find((item) => item.pairId.toLowerCase() === 'btcidr');
  if (!btc) return ranked.slice(0, maxPairs);
  const rest = ranked.filter((item) => item.pairId.toLowerCase() !== 'btcidr');
  return [btc, ...rest].slice(0, maxPairs);
}
