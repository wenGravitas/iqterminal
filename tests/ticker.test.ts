import { expect, it, vi, afterEach } from 'vitest';
import { TICKER_COLUMNS, parseDisplayMinimum, TickerPipeline, TickerTape, classify, defaultTiers, displayed, tickerConfig, validateTiers, tradeSize, TICKER_MAX_RECENT } from '../src/ticker/model';
import { NotificationGate } from '../src/notifications';
import { TickerService } from '../src/feed/ticker-service';
import { restoreValue } from '../src/layout';
import { executionMarkets } from '../src/markets';
import type { NormalizedExecution } from '../src/feed/footprint';
const now = 1791745000000;
const execution = (id='1', amount=1e6, side: NormalizedExecution['side']='buy', timeMs=now): NormalizedExecution => ({ venue:'binance', market:'perpetual', nativeSymbol:'BTCUSDT', granularity:'aggregate-trade', executionId:`binance:perpetual:BTCUSDT:agg:${id}`, timeMs,eventTimeMs:timeMs,price:100000,quantity:amount/100000,side });
afterEach(()=>vi.useRealTimers());
it('selects the highest qualifying tier with exact threshold inclusion and accurate BTC/USDT units',()=>{
  const c=tickerConfig({});expect(classify(execution('1',99999),c)?.name).toBe('Small');expect(classify(execution('2',100000),c)?.name).toBe('Large');expect(classify(execution('3',1e6),c)?.name).toBe('Very large');expect(tradeSize(execution(),'BTC')).toBe(10);expect(tradeSize(execution(),'USDT')).toBe(1e6);
  c.tiers.reverse();expect(classify(execution(),c)?.minimum).toBe(1e6);
});
it('rejects duplicate thresholds, mixed ladder units, corrupt colours and invalid volumes',()=>{
  const t=defaultTiers();expect(()=>validateTiers([...t,{...t[1],id:'another'}])).toThrow('unique');expect(()=>validateTiers([t[0],{...t[1],unit:'BTC'}])).toThrow('One ladder');expect(()=>validateTiers([{...t[0],buyColor:'url(evil)'}])).toThrow('colours');expect(()=>validateTiers([{...t[0],volume:2}])).toThrow('volume');
});
it('keeps unknown sides explicit rather than treating them as buys',()=>{const e=execution('unknown',1e6,'unknown'),c=tickerConfig({});expect(displayed(e,c)).toBe(true);expect(displayed(e,{...c,side:'buy'})).toBe(false);expect(displayed(e,{...c,side:'unknown'})).toBe(true);expect(e.side).toBe('unknown');});
it('deduplicates executions while filters leave classification and freshness intact for the UI delivery gate',()=>{
  const p=new TickerPipeline(tickerConfig({displayMinimum:2e6,side:'sell'}),now-1000),r=p.accept(execution(),now,now-1000)!;expect(r.tier?.name).toBe('Very large');expect(r.notify).toBe(true);expect(displayed(r.execution,p.config)).toBe(false);expect(p.accept(execution(),now,now-1000)).toBeNull();expect(p.retained.length).toBe(1);
});
it('suppresses stale, reconnect backlog and pre-subscription events',()=>{const p=new TickerPipeline(tickerConfig({}),now-1000);expect(p.accept(execution('old',1e6,'buy',now-10000),now,now-1000)?.notify).toBe(false);expect(p.accept(execution('reconnect',1e6,'buy',now-500),now,now)?.notify).toBe(false);expect(p.accept(execution('fresh'),now,now-1000)?.notify).toBe(true);});
it('paused tape ingests bounded rows and catches up without mutating its frozen view',()=>{const p=new TickerPipeline(tickerConfig({}),now-1),tape=new TickerTape();tape.ingest([p.accept(execution(),now,now-1)!]);tape.pause();for(let n=0;n<600;n++)tape.ingest([p.accept(execution(String(n+2)),now,now-1)!]);expect(tape.rows.length).toBe(500);expect(tape.visible(p.config)).toHaveLength(1);tape.live();expect(tape.visible(p.config)).toHaveLength(100);expect(p.retained.length).toBe(500);});
it('clears its bounded tape, ignores pre-clear batches, and keeps collecting while paused',()=>{
  const config=tickerConfig({}),pipeline=new TickerPipeline(config,now),tape=new TickerTape();
  const first=pipeline.accept(execution('first'),now,now)!;
  const queued=pipeline.accept(execution('queued'),now,now)!;
  tape.ingest([first]);tape.pause(now);tape.clear(now);
  expect(tape.rows).toEqual([]);expect(tape.visible(config)).toEqual([]);expect(tape.snapshot(now+1000)).toEqual({records:[],now});expect(tape.paused).toBe(true);
  tape.ingest([first,queued]);expect(tape.rows).toEqual([]);
  const fresh=pipeline.accept(execution('fresh',1e6,'buy',now+1),now+1,now)!;tape.ingest([fresh]);
  expect(tape.rows).toEqual([fresh]);expect(tape.visible(config)).toEqual([]);
  tape.live();expect(tape.visible(config)).toEqual([fresh]);
});
it('caps dedup memory and preserves stable configured scope without silently adding inputs',()=>{const p=new TickerPipeline(tickerConfig({}),now);for(let n=0;n<TICKER_MAX_RECENT+10;n++)p.accept(execution(String(n)),now,now);expect((p as any).recent.size).toBe(TICKER_MAX_RECENT);expect(classify(execution(),tickerConfig({scope:[]}))).toBeNull();expect(executionMarkets(['binance:perpetual','binance:perpetual','binance:spot','hyperliquid:perpetual'])).toEqual(['binance:perpetual','binance:spot']);});
it('persists settings and validates versioned ticker layouts without breaking legacy charts',()=>{const c=tickerConfig({muted:true,displayMinimum:123});expect(tickerConfig(JSON.parse(JSON.stringify(c)))).toEqual(c);const layout={grid:{},panels:{'ticker-one':{contentComponent:'trade-ticker',params:c}}};expect(restoreValue(JSON.stringify({version:4,layout}))).toEqual(layout);expect(restoreValue(JSON.stringify({version:3,layout}))).toBeNull();});
it('notification gate deduplicates, rate limits, mutes and suppresses hidden/stale events',()=>{const g=new NotificationGate(),r={eventId:'event',ruleId:'ticker-a:large',owner:'ticker-a',timeMs:now,fresh:true,title:'Large',text:'Trade',sound:'bell' as const,volume:.5,toast:true};expect(g.accept(r,now,false)).toBe(true);expect(g.accept(r,now,false)).toBe(false);expect(g.accept({...r,eventId:'stale'},now+4000,false)).toBe(false);expect(g.accept({...r,eventId:'hidden'},now,true)).toBe(false);expect(g.accept({...r,eventId:'muted',muted:true},now,false)).toBe(false);expect(g.accept({...r,eventId:'cool'},now+100,false)).toBe(false);g.release('ticker-a');expect(g.diagnostics().cooldowns).toBe(0);});
it('notification state remains bounded under many independent rules',()=>{const g=new NotificationGate();for(let n=0;n<3000;n++)g.accept({eventId:String(n),ruleId:`ticker:${n}`,owner:'ticker',timeMs:now+n*1000,fresh:true,title:'x',text:'x',sound:'silent',volume:0,toast:false},now+n*1000,false);expect(g.diagnostics().recent).toBeLessThanOrEqual(2048);expect(g.diagnostics().cooldowns).toBeLessThanOrEqual(128);});
it('worker backpressure caps pending prints, rejects stale acknowledgements and releases consumers',()=>{
  vi.useFakeTimers();const listeners=new Map<string,Function>(),releases=vi.fn();const feed={subscribeExecutions(id:string,callback:Function){listeners.set(id,callback);return()=>{listeners.delete(id);releases();};}};const events:any[]=[];const service=new TickerService(feed as any,e=>events.push(e),()=>now);
  service.subscribe('one',{});service.subscribe('two',{});expect(listeners.size).toBe(2);const first=events[0];listeners.get('one')!(Array.from({length:1000},(_,i)=>execution(String(i))),{state:'live',message:'live',lastUpdate:now},now-1000);service.flush();expect(service.diagnostics().subscribers[0].pending).toBe(256);expect(service.diagnostics().subscribers[0].dropped).toBe(744);service.ack('one',first.generation+1,first.batchId);expect(events.length).toBe(2);service.ack('one',first.generation,first.batchId);expect(events[2].records.length).toBe(256);service.update('one',{tiers:[{...defaultTiers()[0],name:'Edited'}]},1);expect(listeners.size).toBe(2);expect(releases).not.toHaveBeenCalled();service.unsubscribe('one');expect(listeners.size).toBe(1);service.dispose();expect(releases).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
});

it('subscribes Spot and USD-M separately and preserves their independent execution identities',()=>{
  vi.useFakeTimers();const feeds=new Map<string,Function>(),makeFeed=(name:string)=>({subscribeExecutions(id:string,callback:Function){feeds.set(`${name}:${id}`,callback);return()=>{feeds.delete(`${name}:${id}`);};}});
  const events:any[]=[],service=new TickerService({spot:makeFeed('spot') as any,perpetual:makeFeed('perpetual') as any},event=>events.push(event),()=>now);
  service.subscribe('both',{markets:['binance:spot','binance:perpetual']});
  expect([...feeds.keys()]).toEqual(['spot:both:spot','perpetual:both:perpetual']);
  const status={state:'live',message:'live',lastUpdate:now};
  feeds.get('spot:both:spot')!([{...execution('1'),market:'spot',executionId:'binance:spot:BTCUSDT:agg:1'}],status,now-1000);
  feeds.get('perpetual:both:perpetual')!([execution('1')],status,now-1000);
  for(let i=0;i<events.length;i++){const event=events[i];service.ack('both',event.generation,event.batchId);}
  const records=events.flatMap(event=>event.records??[]).map(record=>record.execution);
  expect(records.map(item=>item.market).sort()).toEqual(['perpetual','spot']);
  expect(new Set(records.map(item=>item.executionId)).size).toBe(2);
  service.dispose();expect(feeds.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
});

it('keeps time mandatory and validates optional columns without losing explicit empty choices',()=>{
  expect(tickerConfig({}).columns).toEqual(TICKER_COLUMNS.map(c=>c.id));
  expect(tickerConfig({columns:['time','venueIcon','venueIcon','bad','quantity']}).columns).toEqual(['venueIcon','quantity']);
  expect(tickerConfig({columns:[]}).columns).toEqual([]);
  const c=tickerConfig({columns:['venueIcon','notional'],displayMinimum:.5,displayUnit:'BTC'});expect(tickerConfig(JSON.parse(JSON.stringify(c)))).toEqual(c);
});
it('parses bounded editable quick-filter sizes without coercing invalid text to zero',()=>{
  for(const [text,value] of [['100K',100000],['1m',1e6],['.25',.25],['0',0],[' 2.5 k ',2500]] as const)expect(parseDisplayMinimum(text)).toBe(value);
  for(const text of ['','-1','Infinity','1e20','1e3','1000001M','<script>'])expect(parseDisplayMinimum(text)).toBeNull();
});

it('retains displayed prints through hidden traffic and evicts only at the matching-row limit',()=>{
  const config=tickerConfig({displayMinimum:100000,side:'buy'}),pipeline=new TickerPipeline(config,now-1),tape=new TickerTape();tape.configure(config);
  const first=pipeline.accept(execution('fixed',1000000),now,now-1)!;tape.ingest([first]);
  const original=JSON.stringify(first);
  for(let n=0;n<1000;n++)tape.ingest([pipeline.accept(execution(`hidden-${n}`,n%2?1000:1000000,n%2?'buy':'sell'),now,now-1)!]);
  expect(tape.rows).toHaveLength(500);expect(tape.rows).not.toContain(first);expect(tape.visible(config)).toEqual([first]);expect(JSON.stringify(first)).toBe(original);
  for(let n=0;n<99;n++)tape.ingest([pipeline.accept(execution(`match-${n}`),now,now-1)!]);
  expect(tape.visible(config)).toHaveLength(100);expect(tape.visible(config).at(-1)).toBe(first);
  tape.ingest([pipeline.accept(execution('next'),now,now-1)!]);expect(tape.visible(config)).toHaveLength(100);expect(tape.visible(config)).not.toContain(first);expect(tape.visible(config)[0].execution.executionId).toContain('next');
});
it('keeps paused matching rows independent and rebuilds only on explicit display-filter edits',()=>{
  const config=tickerConfig({displayMinimum:100000}),pipeline=new TickerPipeline(config,now-1),tape=new TickerTape();tape.configure(config);
  const first=pipeline.accept(execution('first'),now,now-1)!;tape.ingest([first]);tape.pause(now);
  for(let n=0;n<600;n++)tape.ingest([pipeline.accept(execution(`small-${n}`,1000),now,now-1)!]);
  const next=pipeline.accept(execution('next'),now,now-1)!;tape.ingest([next]);
  expect(tape.visible(config)).toEqual([first]);expect(tape.snapshot(now+10000).now).toBe(now);
  tape.configure({...config,displayMinimum:2000000});expect(tape.visible({...config,displayMinimum:2000000})).toEqual([]);
  tape.configure(config);expect(tape.visible(config)).toEqual([first]);tape.live();expect(tape.visible(config)).toEqual([next]);
  // Lowering the filter reuses recent raw history, without duplicate retained overlap.
  const lower={...config,displayMinimum:0};const visible=tape.visible(lower);expect(visible).toHaveLength(100);expect(new Set(visible.map(r=>r.execution.executionId)).size).toBe(100);expect(visible[0]).toBe(next);
});
