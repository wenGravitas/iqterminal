import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { IndexedDbJournalRepository, imageAsset } from '../src/journal/repository';
import { exportJournal, importJournal } from '../src/journal/import-export';
import { reviseEntry } from '../src/journal/model';
import { captureRecord } from '../src/journal/capture';
import { journalBundle, pngBytes } from './helpers/journal';
let repository: IndexedDbJournalRepository;
beforeEach(()=>{vi.stubGlobal('IDBKeyRange',IDBKeyRange);vi.stubGlobal('navigator',{storage:{estimate:async()=>({usage:100,quota:10000}),persist:async()=>true}});repository=new IndexedDbJournalRepository(new IDBFactory(),'journal-tests');});
afterEach(()=>{repository.close();vi.unstubAllGlobals();});
describe('journal IndexedDB transactions',()=>{
  it('commits complete records, queries exact instrument/time and preserves original capture through edits',async()=>{
    const bundle=journalBundle();expect(await repository.save([bundle])).toEqual({added:1,duplicates:0});expect(await repository.save([bundle])).toEqual({added:0,duplicates:1});
    expect(await repository.query({instrument:bundle.entry.instrument,from:bundle.entry.marketTime,to:bundle.entry.marketTime})).toHaveLength(1);expect(await repository.query({instrument:'other'})).toEqual([]);
    const revised=reviseEntry(bundle.entry,{title:'Reasoning',note:'hello',tags:['zone'],reasoning:bundle.entry.reasoning});await repository.update(revised,1);expect((await repository.entry(bundle.entry.id))?.revisions).toHaveLength(2);expect(await repository.capture(bundle.capture.id)).toEqual(bundle.capture);await expect(repository.update(revised,1)).rejects.toThrow(/another editor/);
  });
  it('rolls a multi-entry import back on ID conflict without orphaning earlier captures',async()=>{
    const existing=journalBundle('exists');await repository.save([existing]);const fresh=journalBundle('new');const conflict={...journalBundle('exists'),capture:journalBundle('different').capture};conflict.entry={...conflict.entry,captureId:conflict.capture.id};
    await expect(repository.save([fresh,conflict])).rejects.toThrow(/conflict/);expect(await repository.entry('new')).toBe(null);expect(await repository.capture(fresh.capture.id)).toBe(null);expect((await repository.usage()).entries).toBe(1);
  });
  it('round trips PNG blobs and timestamps through backups, and cleans only unreferenced assets',async()=>{
    const bundle=journalBundle(),asset=await imageAsset('full',new Blob([pngBytes()],{type:'image/png'})),thumb=await imageAsset('thumb',new Blob([pngBytes()],{type:'image/png'}));bundle.capture=captureRecord(bundle.capture.snapshot,bundle.capture.id,'full','thumb',[]);bundle.assets=[asset,thumb];await repository.save([bundle]);
    const backup=await exportJournal(repository,[bundle.entry]);const other=new IndexedDbJournalRepository(new IDBFactory(),'journal-import');try{expect(await importJournal(other,backup)).toEqual({added:1,duplicates:0});expect(await importJournal(other,backup)).toEqual({added:0,duplicates:1});expect(await other.entry(bundle.entry.id)).toEqual(bundle.entry);expect((await other.asset('full'))?.sha256).toBe(asset.sha256);expect((await other.usage()).assets).toBe(2);await other.delete(bundle.entry.id);expect((await other.usage()).assets).toBe(0);expect(await other.capture(bundle.capture.id)).toBe(null);}finally{other.close();}
  });
  it('rejects future backup versions before writing anything and surfaces denied storage',async()=>{
    await expect(importJournal(repository,new Blob([JSON.stringify({format:'iqterminal-journal',version:99,entries:[]})]))).rejects.toThrow(/Unsupported/);expect((await repository.usage()).entries).toBe(0);
    const denied=new IndexedDbJournalRepository({open(){throw new DOMException('Storage denied','SecurityError');}} as unknown as IDBFactory,'denied');try{await expect(denied.save([journalBundle()])).rejects.toThrow(/denied/);}finally{denied.close();}
  });
});

it('preserves corrupt and future records byte-for-byte instead of resetting the journal',async()=>{
  const bundle=journalBundle();await repository.save([bundle]);const db=await (repository as any).open() as IDBDatabase;const future={...bundle.entry,id:'future',version:99,unknownEvidence:'retain this'};await new Promise<void>((resolve,reject)=>{const tx=db.transaction('entries','readwrite');tx.objectStore('entries').add(future);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});await expect(repository.entry('future')).rejects.toThrow(/Unsupported/);expect(await repository.entry(bundle.entry.id)).toEqual(bundle.entry);const raw=await new Promise(resolve=>{const request=db.transaction('entries','readonly').objectStore('entries').get('future');request.onsuccess=()=>resolve(request.result);});expect(raw).toEqual(future);
});
it('keeps shared capture assets until the last referencing entry is explicitly deleted',async()=>{
  const bundle=journalBundle(),asset=await imageAsset('full',new Blob([pngBytes()],{type:'image/png'})),thumb=await imageAsset('thumb',new Blob([pngBytes()],{type:'image/png'}));bundle.capture=captureRecord(bundle.capture.snapshot,bundle.capture.id,'full','thumb',[]);bundle.assets=[asset,thumb];const shared={...bundle,entry:{...bundle.entry,id:'second-entry'}};await repository.save([bundle,shared]);await repository.delete(bundle.entry.id);expect((await repository.usage()).assets).toBe(2);expect(await repository.capture(bundle.capture.id)).not.toBe(null);await repository.delete(shared.entry.id);expect((await repository.usage()).assets).toBe(0);
});
