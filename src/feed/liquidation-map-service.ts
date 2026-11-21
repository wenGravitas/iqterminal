import { mapSettings, type MapSettings, type MapPayload, type MapBatch } from '../liquidation-map/model';
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
    private sizes = new Map<string, number>();
    private flights = new Map<string, Promise<MapPayload>>();
    private timer?: ReturnType<typeof setInterval>;
    private abort = new AbortController();
    constructor(private emit: (event: MapBatch) => void) { }
    subscribe(id: string, from: number, to: number, settings: MapSettings) { if (!this.clients.has(id) && this.clients.size >= 8)
        return; this.clients.set(id, { from, to, settings: mapSettings(settings), pending: false, dirty: true }); if (!this.timer)
        this.timer = setInterval(() => { for (const c of this.clients.values())
            c.dirty = true; void this.flush(); }, 10000); void this.flush(); }
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
        const started=performance.now();
        const instrument=import.meta.env.VITE_DIAGNOSTICS==='1';
        if (import.meta.env.VITE_DATA_MODE !== 'staging')
            throw Error('Liquidation Map requires the shared staging backend');
        const requested = c.settings.resolution;
        const end = Math.min(c.to, Date.now() + requested), start = Math.max(0, c.from, end - c.settings.lookback);
        // Time LOD is an as-of stock snapshot, never a sum through time. Bound
        // the visible window to roughly 128 columns before requesting detail.
        const resolution = Math.min(3600000, requested * Math.max(1, Math.ceil((end - start) / (128 * requested))));
        const to = Math.ceil(end / resolution) * resolution, from = Math.max(0, Math.floor(start / resolution) * resolution);
        const key = `${from}:${to}:${resolution}:${c.settings.priceWidth}`;
        const exact = this.cache.get(key);
        const compatible = [...this.cache.values()].filter(item => item.payload.resolution === resolution && item.payload.priceWidth === c.settings.priceWidth && item.payload.from < to && item.payload.to > from);
        const cached = exact ?? compatible.sort((a,b) => Math.min(b.payload.to,to)-Math.max(b.payload.from,from) - (Math.min(a.payload.to,to)-Math.max(a.payload.from,from)))[0];
        const fresh = cached && Date.now() - cached.at < 10000;
        if (fresh && cached.payload.from <= from && cached.payload.to >= to)
            return { ...cached.payload, from, to, ...(instrument?{acquisition:{workerElapsedMs:performance.now()-started,requests:0,headersMs:0,bodyMs:0,decodeMs:0,bytes:0,cache:'warm' as const}}:{}) };
        const existing = this.flights.get(key);
        if (existing) return existing;
        const task = (async () => {
            const timings={workerElapsedMs:0,requests:0,headersMs:0,bodyMs:0,decodeMs:0,bytes:0,cache:'network' as const,serverTimings:[] as string[]};
            const columns: MapPayload['columns'] = cached ? [...cached.payload.columns] : [];
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
                    const params = new URLSearchParams({from:String(segment.from),to:String(segment.to),resolution:String(resolution),priceWidth:String(c.settings.priceWidth),after:String(after)});
                    if (head !== undefined) params.set('head',String(head));
                    const requestStarted=performance.now();
                    const response = await fetch('/market-data/v1/liquidation-map/tiles?'+params,{signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(25000)])});
                    const serverTiming=response.headers.get('server-timing');if(serverTiming)timings.serverTimings.push(serverTiming);
                    timings.requests++;timings.headersMs+=performance.now()-requestStarted;
                    if (response.status===409 && !reset) {
                        columns.length=0; head=undefined;reset=true;
                        segments=[{from,to,after:0}];segmentIndex=-1;break;
                    }
                    if (!response.ok) throw Error(`Liquidation Map HTTP ${response.status}`);
                    const bodyStarted=performance.now(), body=await response.arrayBuffer();
                    timings.bodyMs+=performance.now()-bodyStarted;timings.bytes+=body.byteLength;
                    if(body.byteLength>8*1024*1024)throw Error('Liquidation Map response body capacity');
                    const decodeStarted=performance.now(),page:MapPayload=JSON.parse(new TextDecoder().decode(body));
                    timings.decodeMs+=performance.now()-decodeStarted;
                    if(page.version!==1||page.semantics!=='conditional-exposure'||!Array.isArray(page.columns)||page.columns.length>256||!Array.isArray(page.sources)||!Number.isSafeInteger(page.head)||page.next!==null&&(!Number.isSafeInteger(page.next)||page.next<=after)) throw Error('Invalid Liquidation Map response');
                    payload=page;head=page.head;columns.push(...page.columns);
                    if(columns.length>4096)throw Error('Liquidation Map tile capacity');
                    if(page.next===null)break;
                    after=page.next;
                }
            }
            if(!payload)throw Error('Missing Liquidation Map payload');
            const merged=[...new Map(columns.map(column=>[column.availableAt,column])).values()].sort((a,b)=>a.availableAt-b.availableAt), latest=merged.at(-1);
            payload={...payload,from,to,resolution,priceWidth:c.settings.priceWidth,columns:merged.filter(column=>column===latest||column.availableAt>=from&&column.availableAt<to).slice(-2048)};
            if(instrument){timings.workerElapsedMs=performance.now()-started;payload.acquisition=timings;}
            const bytes=JSON.stringify(payload).length*2;
            if(bytes>8*1024*1024)throw Error('Liquidation Map worker payload capacity');
            this.cacheBytes-=this.sizes.get(key)??0;this.cache.set(key,{at:Date.now(),payload});this.sizes.set(key,bytes);this.cacheBytes+=bytes;
            while(this.cache.size>12||this.cacheBytes>32*1024*1024){const oldest=this.cache.keys().next().value!;this.cacheBytes-=this.sizes.get(oldest)??0;this.sizes.delete(oldest);this.cache.delete(oldest);}
            return payload;
        })();
        this.flights.set(key, task);
        try {
            return await task;
        }
        finally {
            this.flights.delete(key);
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
    dispose() { for (const id of [...this.clients.keys()])
        this.unsubscribe(id); this.cache.clear(); this.sizes.clear(); this.cacheBytes = 0; }
}
