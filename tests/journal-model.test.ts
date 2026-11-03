import { describe, expect, it } from 'vitest';
import { canonicalMarket, marketIdentity, marketSeries, validateEntry, validateCapture, reviseEntry, immutableCopy, publicCaptureCopy } from '../src/journal/model';
import { clusterMarkers, coveredMarkerIndex } from '../src/journal/markers';
import { journalDayRange } from '../src/journal/global-panel';
import { journalBundle, journalTime } from './helpers/journal';

describe('immutable local journal model', () => {
  it('isolates exact venue, market, symbol and aggregation membership', () => {
    const identities = [canonicalMarket({venue:'binance',market:'spot',interval:'1m'}),canonicalMarket({venue:'binance',market:'perpetual',interval:'5m'}),canonicalMarket({venue:'hyperliquid',market:'perpetual',interval:'1m'}),{venue:'aggregate',market:'spot',symbol:'BTC',aggregation:{version:1,members:['a','b']}},{venue:'aggregate',market:'spot',symbol:'BTC',aggregation:{version:1,members:['a']}}].map(marketIdentity);
    expect(new Set(identities).size).toBe(5); expect(marketSeries({venue:'binance',market:'spot',symbol:'ETHUSDT'},'1m')).toBe(null);
  });
  it('rejects seconds, future schemas, unsafe source state and unsupported replay claims', () => {
    const bundle = journalBundle();
    expect(()=>validateEntry({...bundle.entry,entryAt:journalTime/1000})).toThrow(/milliseconds/);
    expect(()=>validateCapture({...bundle.capture,version:2})).toThrow(/Unsupported/);
    expect(()=>validateCapture({...bundle.capture,replay:{...bundle.capture.replay,retention:'preserved'}})).toThrow(/replay/);
    expect(()=>validateCapture({...bundle.capture,snapshot:{...bundle.capture.snapshot,config:{...bundle.capture.snapshot.config,apiKey:'do-not-save'}}})).toThrow(/Credential/);
    expect(publicCaptureCopy({safe:1,apiKey:'do-not-save'})).toEqual({safe:1});
  });
  it('detaches nested captured state and retains original notes and capture times after revisions', () => {
    const live = { drawings:[{style:{color:'red'}}],composition:{panes:[{memberIds:['cvd']}]}}; const frozen=immutableCopy(live); live.drawings[0]!.style.color='blue';live.composition.panes[0]!.memberIds.push('sma'); expect(frozen.drawings[0]!.style.color).toBe('red');expect(frozen.composition.panes[0]!.memberIds).toEqual(['cvd']);
    const {entry,capture}=journalBundle();const revised=reviseEntry(entry,{title:'Zone',bodyMarkdown:'Thesis',tags:['test']},journalTime+1000);
    expect(revised.entryAt).toBe(entry.entryAt);expect(revised.createdAt).toBe(entry.createdAt);expect(revised.revisions[0]!.bodyMarkdown).toBe('');expect(revised.revisions[1]!.bodyMarkdown).toBe('Thesis');expect(capture.snapshot.config.interval).toBe('1m');expect(Object.isFrozen(capture.snapshot)).toBe(true);
  });
  it('uses explicit UTC millisecond and timezone boundaries, including London DST', () => {
    expect(journalDayRange('2026-11-02','UTC')).toEqual({from:Date.UTC(2026,10,2),to:Date.UTC(2026,10,3)});
    expect(journalDayRange('2026-07-02','Europe/London')).toEqual({from:Date.UTC(2026,6,1,23),to:Date.UTC(2026,6,2,23)});
    expect(journalDayRange('2026-11-02','Africa/Nairobi')).toEqual({from:Date.UTC(2026,10,1,21),to:Date.UTC(2026,10,2,21)});
  });
});

describe('bounded journal marker geometry',()=>{
  it('clusters by pixels without changing timestamps or creating missing-history anchors',()=>{
    const bundle=journalBundle();const links=Array.from({length:500},(_,i)=>({entry:{...bundle.entry,id:String(i),entryAt:journalTime+i*1000},attachment:{id:`attachment-${i}`,kind:'chart-capture' as const,assetId:'chart-image',chartCapture:{...bundle.capture,marketTime:journalTime+i*1000}}}));const clusters=clusterMarkers(links,time=>(time-journalTime)/1000,500,24);expect(clusters.length).toBeLessThan(40);expect(clusters.flatMap(c=>c.links)).toHaveLength(500);expect(links[0]!.attachment.chartCapture.marketTime).toBe(journalTime);
    const sameEntryLinks=[101,102].map((marketTime,i)=>({entry:bundle.entry,attachment:{id:`same-entry-attachment-${i}`,kind:'chart-capture' as const,assetId:`image-${i}`,chartCapture:{...bundle.capture,marketTime}}}));const sameEntryCluster=clusterMarkers(sameEntryLinks,time=>(time-100)/1000,500,24);expect(sameEntryCluster).toHaveLength(1);expect(sameEntryCluster[0]!.links.map(link=>link.attachment.id)).toEqual(['same-entry-attachment-0','same-entry-attachment-1']);
    const times=[journalTime/1000,journalTime/1000+60,journalTime/1000+180];const data={length:3,indexToTime:(i:number)=>times[i],timeToIndexFloat:(time:number)=>time<times[1]!?(time-times[0]!)/60:1+(time-times[1]!)/120};
    expect(coveredMarkerIndex(journalTime+30000,data,60000)).toBe(.5);expect(coveredMarkerIndex(journalTime+120000,data,60000)).toBe(null);expect(coveredMarkerIndex(journalTime-1,data,60000)).toBe(null);expect(coveredMarkerIndex(journalTime+240000,data,60000)).toBe(null);expect(coveredMarkerIndex(journalTime+30000,data,null)).toBe(null);
  });
});
