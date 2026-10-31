import type { Depth } from '@/lib/indodax/schemas';
import { formatIdr } from '@/lib/format';

export function Orderbook({ depth }: { depth: Depth }) {
  const asks = depth.sell.slice(0, 5).reverse();
  const bids = depth.buy.slice(0, 5);
  return <div className="orderbook"><div className="book-head"><span>ASK / JUAL</span><span>VOL</span></div>{asks.map(([price, amount]) => <div className="book-row ask" key={`a-${price}`}><span>{formatIdr(price)}</span><span>{amount}</span></div>)}<div className="book-mid">orderbook live</div>{bids.map(([price, amount]) => <div className="book-row bid" key={`b-${price}`}><span>{formatIdr(price)}</span><span>{amount}</span></div>)}<div className="book-head book-foot"><span>BID / BELI</span><span>VOL</span></div></div>;
}
