import { mapSettings, type MapSettings, type MapPayload, type MapBatch } from '../liquidation-map/model';
class MapCapacity extends Error {}
const MAX_PAYLOAD_BYTES=8*1024*1024;
const MAX_CELLS=100000;
interface Client {
    from: number;
    to: number;
    settings: MapSettings;
    pending: boolean;
    dirty: boolean;
}
/** Shared worker acquisition: visual filters do not change the server model. */
export class LiquidationMapService {
    private clients = new Map<string, Client>();
    private cache = new Map<string, {
        at: number;
        payload: MapPayload;
    }>();
    private cacheBytes = 0;
    private learnedLod = new Map<number,{resolution:number;span:number}>();
    private generation = 0;
    private disposed = false;
    private sizes = new Map<string, number>();
    private flights = new Map<string, Promise<MapPayload>>();
    private timer?: ReturnType<typeof setInterval>;
    private abort = new AbortController();
    constructor(private emit: (event: MapBatch) => void) { }
    subscribe(id: string, from: number, to: number, settings: MapSettings) {
        if(this.disposed)return;
        const existing=this.clients.get(id);
        if(existing){existing.from=from;existing.to=to;existing.settings=mapSettings(settings);existing.dirty=true;}
        else {if(this.clients.size>=8)return;this.clients.set(id,{from,to,settings:mapSettings(settings),pending:false,dirty:true});}
        if(!this.timer)this.timer=setInterval(()=>{for(const c of this.clients.values())c.dirty=true;void this.flush();},10000);
        void this.flush();
    }
    ack(id: string) { const c = this.clients.get(id); if (c) {
        c.pending = false;
        if (c.dirty)
            void this.flush();
    } }
    unsubscribe(id: string) { this.clients.delete(id); if (!this.clients.size) {
        clearInterval(this.timer);
        this.timer = undefined;
        this.abort.abort();
        this.abort = new AbortController();
        this.flights.clear();
    } }
    private async read(c: Client) {
        // Freeze a request while viewport/settings updates queue behind its ACK.
        const signal=this.abort.signal,request={...c,settings:c.settings}, learned=this.learnedLod.get(c.settings.priceWidth);
        const span=Math.max(1,Math.min(c.to-c.from,c.settings.lookback));
        let minimum=learned?Math.min(3600000,c.settings.resolution*Math.ceil(learned.resolution*span/learned.span/c.settings.resolution)):0;
        for(;;){
            try{
                const payload=await this.readLevel(request,minimum);
                if(minimum&&!this.disposed){this.learnedLod.delete(request.settings.priceWidth);this.learnedLod.set(request.settings.priceWidth,{resolution:payload.resolution,span});while(this.learnedLod.size>12)this.learnedLod.delete(this.learnedLod.keys().next().value!);}
                return payload;
            }catch(error){
                if(!(error instanceof MapCapacity)||this.disposed||signal.aborted)throw error;
                const resolution=Math.min(3600000,Math.max(minimum,request.settings.resolution*Math.max(1,Math.ceil(span/(64*request.settings.resolution)))));
                if(resolution>=3600000)throw Error('Liquidation Map tile budget exceeded; shorten lookback or increase price grouping');
                minimum=Math.min(3600000,resolution*2);
            }
        }
    }
    private async readLevel(c: Client, minimumResolution:number) {
        const started=performance.now();
        const instrument=import.meta.env.VITE_DIAGNOSTICS==='1';
        if (import.meta.env.VITE_DATA_MODE !== 'staging')
            throw Error('Liquidation Map requires the shared staging backend');
        const settings=c.settings;
        const requested = settings.resolution;
        const end = Math.min(c.to, Date.now() + requested), start = Math.max(0, c.from, end - settings.lookback);
        // Time LOD is an as-of stock snapshot, never a sum through time. Bound
        // the visible window to roughly 64 columns before requesting detail.
        const resolution = Math.min(3600000, Math.max(minimumResolution, requested * Math.max(1, Math.ceil((end - start) / (64 * requested)))));
        const to = Math.ceil(end / resolution) * resolution, from = Math.max(0, Math.floor(start / resolution) * resolution);
        const key = `${from}:${to}:${resolution}:${settings.priceWidth}`;
        const exact = this.cache.get(key);
        const compatible = [...this.cache.values()].filter(item => item.payload.resolution === resolution && item.payload.priceWidth === settings.priceWidth && item.payload.from < to && item.payload.to > from);
        const cached = exact ?? compatible.sort((a,b) => Math.min(b.payload.to,to)-Math.max(b.payload.from,from) - (Math.min(a.payload.to,to)-Math.max(a.payload.from,from)))[0];
        const fresh = cached && Date.now() - cached.at < 10000;
        if (fresh && cached.payload.from <= from && cached.payload.to >= to)
            return { ...cached.payload, from, to, ...(instrument?{acquisition:{workerElapsedMs:performance.now()-started,requests:0,headersMs:0,bodyMs:0,decodeMs:0,bytes:0,cache:'warm' as const}}:{}) };
        const existing = this.flights.get(key);
        if (existing) return existing;
        if(this.flights.size>=8)throw Error('Liquidation Map request capacity; retrying');
        const task = (async () => {
            let generation=this.generation;
            const timings={workerElapsedMs:0,requests:0,headersMs:0,bodyMs:0,decodeMs:0,bytes:0,cache:'network' as const,serverTimings:[] as string[]};
            const columns = new Map<number,MapPayload['columns'][number]>();
            const columnBytes=new Map<number,number>();let retainedBytes=0,cellCount=0;
            const append=(items:MapPayload['columns'])=>{for(const column of items){
                const old=columns.get(column.availableAt);if(old&&old.revision>column.revision)continue;
                const bytes=JSON.stringify(column).length*2;
                retainedBytes+=bytes-(columnBytes.get(column.availableAt)??0);cellCount+=column.cells.length-(old?.cells.length??0);
                if(retainedBytes>MAX_PAYLOAD_BYTES-65536||cellCount>MAX_CELLS||columns.size>=2048&&!old)throw new MapCapacity('Liquidation Map retained tile budget');
                columns.set(column.availableAt,column);columnBytes.set(column.availableAt,bytes);
            }};
            if(cached)append(cached.payload.columns);
            let segments: Array<{from:number;to:number;after:number}> = [];
            if (!cached) segments.push({from,to,after:0});
            else {
                if (from < cached.payload.from) segments.push({from,to:Math.min(to,cached.payload.from),after:0});
                if (to > cached.payload.to) segments.push({from:Math.max(from,cached.payload.to),to,after:0});
                if (!fresh) segments.push({from:Math.max(from,cached.payload.from),to:Math.min(to,cached.payload.to),after:cached.payload.head});
            }
            let head: number | undefined, payload = cached?.payload, reset = false;
            for (let segmentIndex=0; segmentIndex<segments.length; segmentIndex++) {
                const segment = segments[segmentIndex];
                let after = segment.after;
                while (true) {
                    const params = new URLSearchParams({from:String(segment.from),to:String(segment.to),resolution:String(resolution),priceWidth:String(settings.priceWidth),after:String(after)});
                    if (head !== undefined) params.set('head',String(head));
                    const requestStarted=performance.now();
                    const response = await fetch('/market-data/v1/liquidation-map/tiles?'+params,{signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(25000)])});
                    if(generation!==this.generation){await response.body?.cancel();throw Error('Liquidation Map source reset; retrying');}
                    const serverTiming=response.headers.get('server-timing');if(serverTiming)timings.serverTimings.push(serverTiming);
                    timings.requests++;timings.headersMs+=performance.now()-requestStarted;
                    if (response.status===409 && !reset) {
                        columns.clear();columnBytes.clear();retainedBytes=0;cellCount=0; head=undefined;reset=true;
                        generation=++this.generation;this.cache.clear();this.sizes.clear();this.cacheBytes=0;
                        segments=[{from,to,after:0}];segmentIndex=-1;break;
                    }
                    if (!response.ok) throw Error(`Liquidation Map HTTP ${response.status}`);
                    const bodyStarted=performance.now(), body=await response.arrayBuffer();
                    timings.bodyMs+=performance.now()-bodyStarted;timings.bytes+=body.byteLength;
                    if(body.byteLength>MAX_PAYLOAD_BYTES)throw new MapCapacity('Liquidation Map response body capacity');
                    const decodeStarted=performance.now(),page:MapPayload=JSON.parse(new TextDecoder().decode(body));
                    timings.decodeMs+=performance.now()-decodeStarted;
                    if(generation!==this.generation)throw Error('Liquidation Map source reset; retrying');
                    if(page.version!==1||page.semantics!=='conditional-exposure'||!Array.isArray(page.columns)||page.columns.length>256||!Array.isArray(page.sources)||!Number.isSafeInteger(page.head)||page.next!==null&&(!Number.isSafeInteger(page.next)||page.next<=after)) throw Error('Invalid Liquidation Map response');
                    payload=page;head=page.head;append(page.columns);
                    if(page.next===null)break;
                    after=page.next;
                }
            }
            if(!payload)throw Error('Missing Liquidation Map payload');
            const merged=[...columns.values()].sort((a,b)=>a.availableAt-b.availableAt), latest=merged.at(-1),carry=merged.filter(column=>column.availableAt<from&&column.availableAt>=from-Math.max(resolution,120000)).at(-1);
            payload={...payload,generation,from,to,resolution,priceWidth:settings.priceWidth,columns:merged.filter(column=>column===latest||column===carry||column.availableAt>=from&&column.availableAt<to).slice(-2048)};
            if(instrument){timings.workerElapsedMs=performance.now()-started;payload.acquisition=timings;}
            if(this.disposed)return payload;
            const bytes=JSON.stringify(payload).length*2;
            if(bytes>MAX_PAYLOAD_BYTES)throw new MapCapacity('Liquidation Map worker payload capacity');
            this.cacheBytes-=this.sizes.get(key)??0;this.cache.set(key,{at:Date.now(),payload});this.sizes.set(key,bytes);this.cacheBytes+=bytes;
            while(this.cache.size>12||this.cacheBytes>32*1024*1024){const oldest=this.cache.keys().next().value!;this.cacheBytes-=this.sizes.get(oldest)??0;this.sizes.delete(oldest);this.cache.delete(oldest);}
            return payload;
        })();
        this.flights.set(key, task);
        try {
            return await task;
        }
        finally {
            if(this.flights.get(key)===task)this.flights.delete(key);
        }
    }
    private async flush() { for (const [id, c] of this.clients) {
        if (c.pending || !c.dirty)
            continue;
        c.pending = true;
        c.dirty = false;
        try {
            const payload = await this.read(c);
            if (this.clients.get(id) === c)
                this.emit({ type: 'liquidation-map-batch', ids: [id], payload });
        }
        catch (e) {
            if (this.clients.get(id) === c)
                this.emit({ type: 'liquidation-map-batch', ids: [id], error: (e as Error).message });
        }
    } }
    dispose() { this.disposed=true; for (const id of [...this.clients.keys()])
        this.unsubscribe(id); this.cache.clear(); this.sizes.clear(); this.learnedLod.clear(); this.cacheBytes = 0; }
}
