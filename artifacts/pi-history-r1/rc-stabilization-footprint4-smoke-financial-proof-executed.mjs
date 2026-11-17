/** Post-observation proof against the independently folded canonical reference.
 * Only application presentation tags are excluded. No price/value rounding. */
export async function browserWallFinancialProof(page){
 return page.evaluate(async()=>{
  const engine=window.__terminal?.panels.get('chart-bench')?.engine;
  if(!engine)throw Error('Wall financial proof chart missing');
  const revision=engine.orderWallsDiagnostics().inputRevision;
  const segments=[...engine.orderWallSegments.values()].filter(s=>s.archiveEntryId&&!s.currentSelection);
  if(!segments.length||segments.length>100000)throw Error('Wall financial proof segment capacity');
  segments.sort((a,b)=>a.start-b.start||a.side.localeCompare(b.side)||a.price-b.price);
  const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
  const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(value)))))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const entries=[],ids=new Set();let valueRuns=0,yielded=performance.now();
  for(const segment of segments){
   if(ids.has(segment.id))throw Error('Wall financial proof duplicate identity');ids.add(segment.id);
   valueRuns+=segment.valueRuns.length;if(valueRuns>1000000)throw Error('Wall financial proof value capacity');
   const {currentSelection:_selected,presentationKind:_presentation,...canonical}=segment;
   entries.push([segment.id,await digest(canonical)]);
   if(performance.now()-yielded>=8){await new Promise(resolve=>setTimeout(resolve,0));yielded=performance.now();}
  }
  const financialHash=await digest(entries);
  if(engine.orderWallsDiagnostics().inputRevision!==revision)throw Error('Wall financial proof revision changed during capture');
  return {financialHash,segments:segments.length,valueRuns,revision,scope:'Post-observation stable canonical fields and episode order; presentation tags excluded; no timing or retained-heap proof'};
 });
}
