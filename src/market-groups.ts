import { executionMarkets } from './markets';
import type { CvdGroup } from './feed/cvd';
export const MARKET_GROUP_STORAGE='basis.market-groups.v1';
export function marketGroups(value:unknown):CvdGroup[]{
  if(!Array.isArray(value))return [];
  const ids=new Set<string>();
  return value.slice(0,32).flatMap((v:any)=>{
    if(!v||typeof v.id!=='string'||!/^[\w-]{1,80}$/.test(v.id)||ids.has(v.id)||typeof v.name!=='string'||!v.name.trim())return [];
    ids.add(v.id);return [{id:v.id,name:v.name.trim().slice(0,60),markets:executionMarkets(v.markets),revision:Number.isSafeInteger(v.revision)&&v.revision>0?v.revision:1}];
  });
}
export function readMarketGroups():CvdGroup[]{try{return marketGroups(JSON.parse(localStorage.getItem(MARKET_GROUP_STORAGE)??'[]'));}catch{return [];}}
export function saveMarketGroup(name:string,markets:unknown):CvdGroup{
  const groups=readMarketGroups(),trimmed=name.trim(),members=executionMarkets(markets);
  if(!trimmed||trimmed.length>60||!members.length)throw Error('Give the selected markets a name (1–60 characters).');
  if(groups.length>=32)throw Error('Saved aggregation limit: 32.');
  if(groups.some(g=>g.name.toLowerCase()===trimmed.toLowerCase()))throw Error('An aggregation with this name already exists.');
  const group={id:crypto.randomUUID(),name:trimmed,markets:members,revision:1};
  localStorage.setItem(MARKET_GROUP_STORAGE,JSON.stringify([...groups,group]));return group;
}
