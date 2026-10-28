import { marketName } from '../markets';
import { TICKER_COLUMNS, type TickerColumn, type ClassifiedTrade } from './model';
import { formatDateTime, formatTickerTime } from '../timezone';
export function showTradeColumns(row:HTMLTableRowElement,columns:TickerColumn[]) {
  for(const cell of row.cells)cell.hidden=cell.dataset.column!== 'time'&&!columns.includes(cell.dataset.column as TickerColumn);
}
const quantityFormat = new Intl.NumberFormat('en-US',{maximumFractionDigits:6});
const priceFormat = new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
export function compactSize(value: number) { return Math.abs(value) >= 1e6 ? `${(value/1e6).toFixed(2).replace(/\.00$/,'')}M` : Math.abs(value) >= 1e3 ? `${(value/1e3).toFixed(1).replace(/\.0$/,'')}K` : quantityFormat.format(value); }
export function tradeText(r: ClassifiedTrade) { const e = r.execution; return `${marketName(`${e.venue}:${e.market}`)} · ${e.side} · ${compactSize(e.quantity)} BTC · ${compactSize(e.quantity*e.price)} USDT`; }
export function tradeRow(r: ClassifiedTrade, pulse = false, timezone = 'UTC') {
  const row = document.createElement('tr'); row.className = 'ticker-row';
  row.tabIndex = -1;
  for(const id of ['time',...TICKER_COLUMNS.map(col=>col.id)]){const cell=document.createElement('td');cell.dataset.column=id;row.append(cell);}
  updateTradeRow(row,r,pulse,timezone); return row;
}
export function updateTradeRow(row:HTMLTableRowElement,r:ClassifiedTrade,pulse=false,timezone='UTC') {
  if(row.dataset.executionId===r.execution.executionId) {
    if(row.dataset.displayZone!==timezone) {
      const e=r.execution;
      row.children[0]!.textContent=formatTickerTime(e.timeMs,timezone);
      row.dataset.displayZone=timezone;
      row.setAttribute('aria-label', `${e.venue === 'binance' ? 'Binance' : e.venue === 'bybit' ? 'Bybit' : 'Hyperliquid'} ${e.market === 'perpetual' ? 'perpetual' : 'spot'} ${e.side} execution · ${formatDateTime(e.timeMs,timezone)} ${timezone} · ${priceFormat.format(e.price)} USDT`);
    }
    return;
  }
  row.dataset.executionId = r.execution.executionId;row.dataset.aggressor=r.execution.side;
  const e = r.execution, tier = r.tier;
  row.classList.remove('emphasized','trade-pulse');row.style.removeProperty('--trade-color');
  if (tier) { row.style.setProperty('--trade-color', e.side === 'buy' ? tier.buyColor : e.side === 'sell' ? tier.sellColor : 'var(--muted)'); row.classList.toggle('emphasized',tier.bold); row.classList.toggle('trade-pulse',pulse && tier.pulse); }
  row.removeAttribute('title');
  row.dataset.displayZone=timezone;
  row.setAttribute('aria-label', `${e.venue === 'binance' ? 'Binance' : e.venue === 'bybit' ? 'Bybit' : 'Hyperliquid'} ${e.market === 'perpetual' ? 'perpetual' : 'spot'} ${e.side} execution · ${formatDateTime(e.timeMs,timezone)} ${timezone} · ${priceFormat.format(e.price)} USDT`);
  const cells = [formatTickerTime(e.timeMs,timezone), '', e.venue === 'binance' ? 'Binance' : e.venue === 'bybit' ? 'Bybit' : 'Hyperliquid', e.market === 'perpetual' ? 'Perp' : 'Spot', e.side === 'unknown' ? '?' : e.side === 'buy' ? 'B' : 'S', priceFormat.format(e.price), `${compactSize(e.quantity)} BTC`, `${compactSize(e.quantity*e.price)} USDT`];
  cells.forEach((text,i)=>{row.children[i].textContent=text;});
  const logo=document.createElement('img');logo.className='ticker-venue-icon';logo.src=e.venue==='binance'?'/venues/binance.ico':e.venue==='bybit'?'/venues/bybit.svg':'/venues/hyperliquid.png';logo.alt=e.venue==='binance'?'Binance':e.venue==='bybit'?'Bybit':'Hyperliquid';row.children[1].replaceChildren(logo);
  row.children[4].setAttribute('aria-label',`${e.side} aggressor`); return row;
}
