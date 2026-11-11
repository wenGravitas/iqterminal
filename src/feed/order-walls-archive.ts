import {readWallHistoryHorizon,eligibleWallHistoryRange} from './wall-history-horizon';
import {wallPreparationReason} from './prepared-wall-admission';
import {OrderWallsArchiveProjector} from '../shared/order-walls-projection';
export {OrderWallsArchiveProjector} from '../shared/order-walls-projection';
import {preparedWallReader} from './prepared-wall-history';
import { historyScheduler } from './history-scheduler';
import { historyViewId } from './history-trace';
import {
  orderWallsSettings,
  type OrderWallArchiveStatus,
  type OrderWallMarket,
  type OrderWallPatch,
  type OrderWallSegment,
  type OrderWallStatus,
  type OrderWallValuePoint,
  type OrderWallsSettings,
} from './order-walls';
import { depthSource, preparedDepthFeed } from './prepared-history';

export const ORDER_WALL_ARCHIVE_PAGE_LIMIT = 256;
export const ORDER_WALL_ARCHIVE_MAX_PAGES = 16_384;
export const ORDER_WALL_ARCHIVE_MAX_PATCHES = 500_000;
export const ORDER_WALL_ARCHIVE_MAX_BYTES_PER_PAGE = 4 * 1024 * 1024;
const ORDER_WALL_ARCHIVE_PAGE_TIMEOUT_MS = 60_000;
const ORDER_WALL_ARCHIVE_PAGE_MAX_ATTEMPTS = 3;
const ORDER_WALL_ARCHIVE_RETRY_DELAYS_MS = [500, 1_500] as const;
const ORDER_WALL_ARCHIVE_YIELD_MAX_PAGES = 16;
const ORDER_WALL_ARCHIVE_YIELD_MAX_BYTES = 8 * 1024 * 1024;
const ORDER_WALL_ARCHIVE_YIELD_MAX_MS = 50;
const ORDER_WALL_ARCHIVE_CURRENT_MAX_PAGES_PER_POLL = 64;
const ORDER_WALL_ARCHIVE_CURRENT_MAX_BYTES_PER_PAGE = 4 * 1024 * 1024;
const ORDER_WALL_ARCHIVE_CURRENT_MAX_BYTES_PER_POLL = 16 * 1024 * 1024;

export interface OrderWallsArchiveCandidate {
  entryId: string;
  side: 'bid' | 'ask';
  price: string;
  quantity: string;
  notional: string;
  rank: number;
  startedAt: number;
  startCursor: number;
  startEpoch: number;
  startKnown: boolean;
  /** First raw observation at or after the profile's confirmation boundary. */
  confirmationAt?: number | null;
}

export type OrderWallsArchiveRemovalReason =
  | 'band-exit' | 'rank-exit' | 'below-minimum' | 'observed-zero' | 'gap' | 'replacement-epoch' | 'capacity-unknown';

export interface OrderWallsArchiveRemoval {
  entryId: string;
  side: 'bid' | 'ask';
  price: string;
  at: number;
  cursor: number;
  epoch: number;
  reason: OrderWallsArchiveRemovalReason;
  lastConfirmedAt: number;
  lastConfirmedCursor: number;
}

export interface OrderWallsArchiveBookScope {
  maxLevelsPerSide?: number;
  bidComplete?: boolean;
  askComplete?: boolean;
  bidFloor?: string | number;
  askCeiling?: string | number;
  outerCoverage?: 'snapshot-bounded' | 'complete' | 'unknown' | string;
  snapshotLevels?: { bids: number; asks: number };
  snapshotBidFloor?: string | null;
  snapshotAskCeiling?: string | null;
  observedBidLow?: string | null;
  observedAskHigh?: string | null;
  observedLevels?: { bids: number; asks: number };
  requestedBand?: { bidLow: string; bidHigh: string; askLow: string; askHigh: string } | null;
  bandCoverage?: { bids: 'observed' | 'partial' | 'unknown'; asks: 'observed' | 'partial' | 'unknown' };
}

export interface OrderWallsArchiveSidePatch {
  upserts: OrderWallsArchiveCandidate[];
  removals: OrderWallsArchiveRemoval[];
}

export interface OrderWallsArchivePatch {
  kind: 'patch' | 'gap';
  cursor: number;
  epoch: number;
  at: number;
  midpoint: string | null;
  bids: OrderWallsArchiveSidePatch;
  asks: OrderWallsArchiveSidePatch;
  reason?: string;
  bookScope?: OrderWallsArchiveBookScope;
}

export interface OrderWallsArchiveProfile {
  id: string;
  version: number;
  market: 'spot' | 'perpetual';
  venue: 'binance';
  instrument: string;
  feed: string;
  aggregation: string;
  bandPercent: number;
  midpointBasis: string;
  topN: number;
  algorithmVersion: number;
  schemaVersion: number;
  /** Confirmation settings used by profiles that materialize nonzero delay crossings. */
  confirmationMs: number;
  selectionTopN: number;
  minimumNotionalUsd: string | null;
  exactDerivations: {
    bandPercent: number[];
    topNMax: number;
    minimumNotional: boolean;
    confirmation: boolean;
    confirmationCrossings?: boolean;
    [key: string]: unknown;
  };
}

export interface OrderWallsArchiveCoverage {
  availableFrom: number | null;
  requestedFrom: number;
  requestedTo: number;
  confirmedTo: number | null;
  gaps: Array<{ from?: number; to?: number; at?: number; reason: string }>;
  partial: boolean;
  gapsTruncated?: boolean;
  status: 'building' | 'backfilling' | 'complete' | 'partial' | 'unavailable';
  reason?: string;
  bookScope?: OrderWallsArchiveBookScope;
}

export interface OrderWallsArchivePage {
  version: number;
  profile: OrderWallsArchiveProfile;
  market: 'spot' | 'perpetual';
  instrument: string;
  feed: string;
  from: number;
  to: number;
  watermark: number;
  head?: { cursor: number; at: number; epoch: number };
  /** Backend profile catch-up state; independent of coverage for this fixed request range. */
  profileStatus?: 'building' | 'backfilling' | 'ready' | 'unavailable';
  page: { after: number; nextAfter: number; hasMore: boolean; lastAt: number; limit: number; sameMillisecondClosed: boolean };
  seed?: {
    at: number;
    cursor: number;
    epoch: number;
    midpoint: string | null;
    bookScope?: OrderWallsArchiveBookScope;
    bids: OrderWallsArchiveCandidate[];
    asks: OrderWallsArchiveCandidate[];
  };
  patches: OrderWallsArchivePatch[];
  coverage: OrderWallsArchiveCoverage;
}

export interface OrderWallsArchiveRequest {
  market: OrderWallMarket;
  from: number;
  to: number;
  settings: OrderWallsSettings;
  /** Cursor boundary for a bounded continuation; its timestamp group is already closed. */
  after?: number;
  /** Server-resolved canonical profile ID, including an admitted custom profile. */
  profileId?: string;
  /** Optional fixed cursor fence captured by the current archive endpoint before history paging. */
  watermark?: number;
  /** Client-only evidence for the fixed fence; the server may not retain old progress rows. */
  head?: { cursor: number; at: number; epoch: number };
}

export interface OrderWallsArchiveCurrentPage {
  version: number;
  profile: OrderWallsArchiveProfile;
  market: 'spot' | 'perpetual';
  instrument: string;
  feed: string;
  watermark: number;
  head: { cursor: number; at: number; epoch: number; midpoint: string | null; bookScope?: OrderWallsArchiveBookScope; valid: boolean };
  state?: { bids: OrderWallsArchiveCandidate[]; asks: OrderWallsArchiveCandidate[] };
  page: { after: number; nextAfter: number; hasMore: boolean; lastAt: number | null; limit: number; sameMillisecondClosed: boolean };
  patches: OrderWallsArchivePatch[];
  profileStatus?: 'building' | 'backfilling' | 'ready' | 'unavailable';
  coverage?: Partial<OrderWallsArchiveCoverage> & { status?: string; reason?: string };
}

export interface OrderWallsArchiveCurrentRequest {
  profile: string;
  market: 'spot' | 'perpetual';
  instrument: string;
  aggregation: string;
  bandPercent: number;
  confirmationMs?: number;
  selectionTopN?: number;
  minimumNotionalUsd?: string | null;
  after: number;
  watermark?: number;
  limit?: number;
}

export interface OrderWallsArchiveUpdate {
  kind: 'snapshot' | 'patch';
  segments?: OrderWallSegment[];
  patches?: OrderWallPatch[];
  status: OrderWallStatus;
  watermark?: number;
  head?: { cursor: number; at: number; epoch: number };
  cursor?: number;
  pages: number;
  bytes: number;
  projector?: OrderWallsArchiveProjector;
  resume?: OrderWallsArchiveResumeState;
  /** Validated prepared presentation; never a mutable live accumulator. */
  presentation?:ReadonlyMap<string,OrderWallSegment>;
  /** Every prepared segment was already published and the final proof passed. */
  preparedPresentationComplete?:true;
  preparedSourceToken?:string;
  /** SHA256 of the entire validated selected manifest, including part hashes. */
  preparedPresentationRevision?:string;
}

export interface OrderWallsArchiveCurrentPollerOptions {
  request: OrderWallsArchiveCurrentRequest;
  fetcher?: typeof fetch;
  onPage: (page: OrderWallsArchiveCurrentPage) => void;
  onReset?: (reason: string) => void;
  onSynced?: (head: { cursor: number; at: number; epoch: number }) => void;
  onStatus?: (status: { state: 'loading' | 'catching-up' | 'ready' | 'stale' | 'unavailable'; message?: string; sourceValid?: boolean }) => void;
  intervalMs?: number;
  /** Test/host override; production remains capped at 64 bounded pages per poll. */
  maxPagesPerPoll?: number;
  now?: () => number;
}

export interface OrderWallsArchiveResult extends OrderWallsArchiveUpdate {
  kind: 'snapshot';
  segments: OrderWallSegment[];
  projector?: OrderWallsArchiveProjector;
  head?: { cursor: number; at: number; epoch: number };
}

export interface OrderWallsArchiveLoadOptions {
  request: OrderWallsArchiveRequest;
  signal?: AbortSignal;
  pageLimit?: number;
  fetcher?: typeof fetch;
  /** Existing committed projection carried across a fixed-watermark range extension. */
  initialProjector?: OrderWallsArchiveProjector;
  /** Retains the committed projector and fixed page cursor after a bounded transport failure. */
  resume?: OrderWallsArchiveResumeState;
  preparationRetry?:{token:string;newRevision?:boolean};
  /** Resolve the archive horizon independently of the current selected book. */
  eligibleHistory?:boolean;
  onUpdate?: (update: OrderWallsArchiveUpdate) => void;
  /** Optional bounded-page timings for acceptance diagnostics; callers decide whether to retain them. */
  onPageMetrics?: (metrics: OrderWallsArchivePageMetrics) => void;
}

export interface OrderWallsArchivePageMetrics {
  delivery?:'projection'|'canonical';receivedSegments?:number;
  viewId?:string;requestId?:string;dbQueries?:number;dbReadRows?:number;dbReadBytes?:number;encodedBytes?:number;
  requestedAfter: number;
  pageAfter: number;
  nextAfter: number;
  patchCount: number;
  responseBytes: number;
  responseHeadersMs: number;
  responseBodyReadMs: number;
  jsonParseMs: number;
  validationMs: number;
  projectorApplyMs: number;
  updateCallbackMs: number;
  eventLoopYieldDelayMs: number;
  attempts?: number;
}

export interface OrderWallsArchiveResumeState {
  /** Prepared-prefix revision must be reproved before resuming its projector. */
  preparedSourceToken?:string;
  eligibleTo?:number;
  eligibleHorizonAt?:number;
  after: number;
  watermark?: number;
  head?: OrderWallsArchivePage['head'];
  pages: number;
  bytes: number;
  patchCount: number;
  coverage?: OrderWallsArchiveCoverage;
  lastMidpoint: string | null;
  profileStatus?: OrderWallsArchivePage['profileStatus'];
  projector: OrderWallsArchiveProjector;
}

export interface OrderWallsArchiveAvailability {
  exact: boolean;
  profileId?: string;
  market?: 'spot' | 'perpetual';
  requestedBandPercent: number;
  admissionRequired?: boolean;
  reason?: string;
}

const ARCHIVE_MARKETS = {
  'binance-spot': {
    venueSlug: 'spot', market: 'spot' as const, instrument: 'binance:spot:BTCUSDT',
  },
  'binance-perp': {
    venueSlug: 'usdm', market: 'perpetual' as const, instrument: 'binance:perpetual:BTCUSDT',
  },
} as const;

/** Derives the backend's canonical fixed-profile identity; the server still verifies admission and derivations. */
export function orderWallsArchiveProfileId(market: OrderWallMarket, rawSettings: OrderWallsSettings) {
  const settings = orderWallsSettings(rawSettings), basis = market === 'binance-spot' || market === 'binance-perp' ? ARCHIVE_MARKETS[market] : undefined;
  if (!basis || settings.mode !== 'top-levels') return undefined;
  const feedSlug = depthSource(basis.market).split(':').at(-1)!.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  const band = canonicalPercent(settings.searchRangePercent).replace('.', '_');
  const aggregation = settings.aggregation === 'native' ? 'native' : `${settings.aggregation}usdt`;
  const base = `binance-${basis.venueSlug}-btcusdt-feed-${feedSlug}-band-${band}pct-agg-${aggregation}-top10-a1-s1`;
  if (settings.minDurationMs === 0) return base;
  const minimum = settings.minimumNotionalEnabled
    ? `minusd-${archiveUsdSlug(settings.minimumNotionalUsd)}`
    : 'minoff';
  return `${base}-confirm-${archiveDecimal(settings.minDurationMs).replace('.', '_')}ms-n${settings.topLevels}-${minimum}`;
}

/** The default profile is always-on; other Top Levels identities request bounded server admission. */
export function orderWallsArchiveAvailability(market: OrderWallMarket, rawSettings: OrderWallsSettings, profileId?: string): OrderWallsArchiveAvailability {
  const settings = orderWallsSettings(rawSettings), profile = market === 'binance-spot' || market === 'binance-perp' ? ARCHIVE_MARKETS[market] : undefined;
  if (!profile) return { exact: false, requestedBandPercent: settings.searchRangePercent, reason: 'No durable Order Walls archive profile exists for this market.' };
  if (settings.mode !== 'top-levels') return { exact: false, market: profile.market, requestedBandPercent: settings.searchRangePercent, reason: 'Threshold Walls do not have an exact Top Levels archive profile.' };
  const id = profileId ?? orderWallsArchiveProfileId(market, settings);
  if (settings.aggregation === 'native' && settings.searchRangePercent === 10 && settings.minDurationMs === 0 && !profileId) return { exact: true, profileId: id, market: profile.market, requestedBandPercent: settings.searchRangePercent };
  return { exact: false, profileId: id, market: profile.market, requestedBandPercent: settings.searchRangePercent,
    admissionRequired: true, reason: 'Checking the exact archive profile for these Top Levels settings.' };
}

export function orderWallsArchiveIdentity(request: OrderWallsArchiveRequest) {
  const settings = orderWallsSettings(request.settings), availability = orderWallsArchiveAvailability(request.market, settings, request.profileId);
  if (!availability.profileId || !availability.market) return undefined;
  const identity = expectedProfile(request, settings, availability);
  return JSON.stringify([identity.id, identity.market, identity.instrument, identity.feed, identity.aggregation,
    identity.bandPercent, 10, 1, 1, settings.topLevels, settings.minimumNotionalEnabled ? settings.minimumNotionalUsd : null, settings.minDurationMs]);
}

export function orderWallsArchiveCurrentRequest(request: OrderWallsArchiveRequest, after = 0): OrderWallsArchiveCurrentRequest | undefined {
  const settings = orderWallsSettings(request.settings), availability = orderWallsArchiveAvailability(request.market, settings, request.profileId);
  if (settings.mode !== 'top-levels' || !availability.profileId || !availability.market) return undefined;
  const expected = expectedProfile(request, settings, availability);
  return { profile: expected.id, market: expected.market, instrument: expected.instrument,
    aggregation: expected.aggregation, bandPercent: expected.bandPercent,
    confirmationMs: expected.confirmationMs, selectionTopN: expected.selectionTopN,
    minimumNotionalUsd: expected.minimumNotionalUsd, after,
    limit: ORDER_WALL_ARCHIVE_PAGE_LIMIT };
}

/** Fetches fixed-watermark pages and projects each selected-profile timeline into native chart segments. */
export async function loadOrderWallsArchive(options:OrderWallsArchiveLoadOptions):Promise<OrderWallsArchiveResult>{
 const original=options.request;
 if(!options.eligibleHistory||import.meta.env.VITE_HISTORY_TILES!=='1'||options.initialProjector||options.resume&&options.resume.eligibleTo===undefined)return loadBoundedOrderWallsArchive(options);
 const settings=orderWallsSettings(original.settings),availability=orderWallsArchiveAvailability(original.market,settings,original.profileId);
 if(availability.admissionRequired||!availability.market||!availability.profileId||!Number.isSafeInteger(original.from)||!Number.isSafeInteger(original.to)||original.from>=original.to)return loadBoundedOrderWallsArchive(options);
 const viewId=historyViewId(),fetcher=options.fetcher??fetch;
 const horizonFetcher:typeof fetch=(input,init)=>{const headers=new Headers(init?.headers);headers.set('X-IQ-View-Id',viewId);return fetcher(input,{...init,headers});};
 let to=options.resume?.eligibleTo,horizonAt=options.resume?.eligibleHorizonAt;
 if(to===undefined){
  const horizon=await readWallHistoryHorizon({market:availability.market,profile:availability.profileId},horizonFetcher,options.signal??new AbortController().signal);
  if(!horizon)return loadBoundedOrderWallsArchive(options);
  const range=eligibleWallHistoryRange(original,horizon);to=range.to;horizonAt=range.horizonAt;
 }
 if(to<=original.from){
  const reason='This view is beyond the observed archive horizon; no past interval is eligible yet.';
  const archive={...archiveStatus(original,availability,'partial'),requestComplete:true,rangeComplete:false,eligibleTo:to,horizonAt,reason};
  const result:OrderWallsArchiveResult={kind:'snapshot',segments:[],status:statusForArchive(archive,'partial',reason),pages:0,bytes:0};options.onUpdate?.(result);return result;
 }
 const clipped=to<original.to;
 const annotate=<T extends OrderWallsArchiveUpdate>(update:T):T=>{
  const a=update.status.archive,complete=a?.requestComplete===true;
  const reason=clipped&&complete?[a?.reason,'History is loaded through the archive horizon; later chart time is not covered.'].filter(Boolean).join(' '):a?.reason;
  return {...update,...(update.resume?{resume:{...update.resume,eligibleTo:to,eligibleHorizonAt:horizonAt}}:{}),status:{...update.status,
   ...(clipped?{coverage:{...update.status.coverage,from:original.from,to:original.to,complete:false,partial:true},...(complete?{message:reason}:{})}:{}),
   ...(a?{archive:{...a,to:original.to,eligibleTo:to,...(horizonAt===undefined?{}:{horizonAt}),rangeComplete:!clipped&&a.rangeComplete,
    ...(clipped&&complete?{state:'partial' as const,reason}:{})}}:{})}};
 };
 const result=await loadBoundedOrderWallsArchive({...options,request:{...original,to},onUpdate:update=>options.onUpdate?.(annotate(update))},viewId);
 return annotate(result);
}

async function loadBoundedOrderWallsArchive(options: OrderWallsArchiveLoadOptions,viewId=historyViewId()): Promise<OrderWallsArchiveResult> {
  const { request } = options, settings = orderWallsSettings(request.settings), availability = orderWallsArchiveAvailability(request.market, settings, request.profileId);
  const baseStatus = archiveStatus(request, availability, 'loading');
  if (!availability.exact && !availability.admissionRequired) {
    const status = statusForArchive(baseStatus, 'unavailable', availability.reason);
    const result: OrderWallsArchiveResult = { kind: 'snapshot', segments: [], status, pages: 0, bytes: 0 };
    options.onUpdate?.(result); return result;
  }
  if (!Number.isFinite(request.from) || !Number.isFinite(request.to) || request.from >= request.to) {
    const status = statusForArchive(baseStatus, 'unavailable', 'Requested archive interval is invalid.');
    const result: OrderWallsArchiveResult = { kind: 'snapshot', segments: [], status, pages: 0, bytes: 0 };
    options.onUpdate?.(result); return result;
  }

  const profile = expectedProfile(request, settings, availability);
  const queryFrom = Math.max(0, request.from - settings.minDurationMs);
  const queryRequest = queryFrom === request.from ? request : { ...request, from: queryFrom };
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const pageLimit = Math.max(1, Math.min(ORDER_WALL_ARCHIVE_PAGE_LIMIT, Math.floor(options.pageLimit ?? ORDER_WALL_ARCHIVE_PAGE_LIMIT)));
  const signal = options.signal;
  const correlatedFetcher: typeof fetch = (input, init) => {const headers=new Headers(init?.headers);headers.set('X-IQ-View-Id',viewId);return fetcher(input,{...init,headers});};
  const consumerSignal=signal??new AbortController().signal;
  const prior = options.resume;
  const projector = prior?.projector ?? options.initialProjector ?? new OrderWallsArchiveProjector(settings, queryFrom, request.to);
  let after = prior?.after ?? request.after ?? 0, watermark: number | undefined = prior?.watermark ?? request.watermark,
    watermarkHead: OrderWallsArchivePage['head'] = prior?.head ?? request.head,
    pages = prior?.pages ?? 0, bytes = prior?.bytes ?? 0, patchCount = prior?.patchCount ?? 0;
  let batchPages = 0, batchBytes = 0, batchStartedAt = performance.now();
  let pageCoverage: OrderWallsArchiveCoverage | undefined = prior?.coverage;
  let lastMidpoint: string | null = prior?.lastMidpoint ?? null;
  let profileStatus: OrderWallsArchivePage['profileStatus'] = prior?.profileStatus;
  let sentInitial = pages > 0;
  let lastStatus: OrderWallStatus | undefined;
  const prepared=import.meta.env.VITE_HISTORY_TILES==='1'&&(!after||prior?.preparedSourceToken)?await preparedWallReader({market:profile.market,profile:profile.id,from:queryFrom,to:request.to,
    watermark,head:watermarkHead},correlatedFetcher,consumerSignal,prior?.preparedSourceToken,settings,{retry:options.preparationRetry,onPreparation:preparation=>{
      const reason=wallPreparationReason(preparation);
      const archive:OrderWallArchiveStatus={...archiveStatus(request,availability,'building'),requestComplete:false,rangeComplete:false,
        loadedThrough:Math.min(request.to,Math.max(request.from,prior?.projector.confirmedAt??request.from)),preparation,reason};
      options.onUpdate?.({kind:'patch',patches:[],status:statusForArchive(archive,'building',reason),pages,bytes,...(prior?{resume:prior}:{})});
    }}):null;
  const captureResume = (resumeAfter = after): OrderWallsArchiveResumeState => ({ after: resumeAfter, watermark,
    head: watermarkHead, pages, bytes, patchCount, coverage: pageCoverage, lastMidpoint, profileStatus, projector, ...(prepared?{preparedSourceToken:prepared.sourceToken}:{}) });
  try {
  if(prepared&&!after&&!prior&&!options.initialProjector){
    let painted=false;
    const projected=await prepared.readProjection(settings,progress=>{
      const archive={...archiveStatus(request,availability,'loading'),exact:true,requestComplete:false,rangeComplete:false,loadedThrough:request.from,presentationThrough:progress.presentationThrough};
      const status=statusForArchive(archive,'loading','Loading validated prepared wall records; full range validation pending.');
      const update:OrderWallsArchiveUpdate={kind:painted?'patch':'snapshot',...(painted?{patches:progress.segments.map(segment=>({id:segment.id,segment,replaceValueRuns:true}))}:{segments:progress.segments}),
        presentation:progress.presentation,status,pages:progress.parts,bytes:progress.bytes};
      const at=performance.now();options.onUpdate?.(update);painted=true;
      if(progress.metrics)options.onPageMetrics?.({viewId,delivery:'projection',receivedSegments:progress.segments.length,requestId:progress.metrics.requestId,encodedBytes:progress.metrics.encodedBytes,
        requestedAfter:progress.parts-1,pageAfter:progress.parts-1,nextAfter:progress.parts,patchCount:0,responseBytes:progress.bytes-bytes,responseHeadersMs:progress.metrics.responseHeadersMs,
        responseBodyReadMs:progress.metrics.bodyReadMs,jsonParseMs:progress.metrics.jsonParseMs,validationMs:progress.metrics.validationMs,projectorApplyMs:progress.metrics.mergeMs,updateCallbackMs:performance.now()-at,eventLoopYieldDelayMs:progress.metrics.yieldMs,attempts:progress.metrics.attempts});
      bytes=progress.bytes;
    },candidate=>{if(!profileBasisMatches(candidate,profile)||!orderWallsArchiveDerivationsExact(candidate,settings))throw Error('Prepared wall projection profile is not exactly derivable');});
    if(projected){
      const head=projected.head,coverage=projected.coverage;
      validatePage({version:1,profile:projected.profile,market:projected.profile.market,instrument:projected.profile.instrument,feed:projected.profile.feed,from:queryFrom,to:request.to,watermark:head.cursor,head,
        page:{after:0,nextAfter:head.cursor,hasMore:false,lastAt:coverage.confirmedTo??queryFrom,limit:pageLimit,sameMillisecondClosed:true},patches:[],coverage},profile,queryRequest,0,watermark,watermarkHead);
      const extent=coverage.availableFrom!==null&&coverage.availableFrom<=request.from&&coverage.confirmedTo!==null&&coverage.confirmedTo>=request.to-1;
      const state=coverage.status==='complete'&&(!extent||coverage.partial||coverage.gaps.length||coverage.gapsTruncated)?'partial':coverageState(coverage.status);
      const archive={...archiveStatus(request,availability,state,coverage),exact:true,requestComplete:true,loadedThrough:projected.projector.confirmedAt,
        profileVersion:projected.profile.version,algorithmVersion:projected.profile.algorithmVersion,schemaVersion:projected.profile.schemaVersion,midpoint:projected.projector.selectedState().midpoint};
      const result:OrderWallsArchiveResult={kind:'snapshot',segments:projected.projector.snapshot(),projector:projected.projector,presentation:projected.presentation,preparedPresentationComplete:true,preparedSourceToken:prepared.sourceToken,preparedPresentationRevision:projected.presentationRevision,status:statusForArchive(archive,state,coverage.reason),watermark:head.cursor,head,cursor:head.cursor,pages:projected.parts,bytes:projected.bytes};
      options.onUpdate?.(result);return result;
    }
  }
  for (;;) {
    if (signal?.aborted) throw abortError();
    if (pages >= ORDER_WALL_ARCHIVE_MAX_PAGES || patchCount > ORDER_WALL_ARCHIVE_MAX_PATCHES) {
      const archive = { ...archiveStatus(request, availability, 'partial', pageCoverage), ...(profileStatus ? { profileStatus } : {}) };
      archive.requestComplete = false;
      const status = statusForArchive(archive, 'partial', 'Archive page or patch safety limit reached before the requested interval completed.');
      const segments = projector.snapshot();
      const update: OrderWallsArchiveUpdate = { kind: sentInitial ? 'patch' : 'snapshot', ...(sentInitial ? { patches: [] } : { segments }), status, watermark, head: watermarkHead, cursor: after, pages, bytes, projector };
      options.onUpdate?.(update);
      return { kind: 'snapshot', segments, status, watermark, head: watermarkHead, cursor: after, pages, bytes, projector };
    }
    const params = new URLSearchParams({
      profile: profile.id,
      market: profile.market,
      from: String(queryFrom),
      to: String(request.to),
      after: String(after),
      limit: String(pageLimit),
    });
    if (watermark !== undefined) params.set('watermark', String(watermark));
    if (import.meta.env.VITE_HISTORY_TILES === '1') params.set('display', '1');
    const url = `/market-data/v1/order-walls/archive?${params}`;
    let fetched: Awaited<ReturnType<typeof fetchArchivePageWithRetry>>;
    try { fetched = prepared ? await prepared.read(after) : await historyScheduler.read(url,'order-walls',consumerSignal,upstream=>fetchArchivePageWithRetry(correlatedFetcher,url,after,upstream)); }
    catch (error) {
      if (signal?.aborted) throw abortError();
      if (!(error instanceof OrderWallsArchivePageRequestError)) throw error;
      const message = `Archive request incomplete after ${error.attempts} attempts: ${error.message}. Validated history is retained and can be resumed.`;
      const priorArchive = lastStatus?.archive ?? archiveStatus(request, availability, 'partial', pageCoverage);
      const archive = { ...priorArchive, state: 'partial' as const, requestComplete: false, resumeAfter: after, reason: message,
        ...(profileStatus ? { profileStatus } : {}) };
      const status: OrderWallStatus = { ...(lastStatus ?? statusForArchive(archive, 'loading')),
        state: 'loading', message, coverage: { from: request.from, to: request.to, complete: false, partial: true, reason: message }, archive };
      const segments = projector.snapshot(), resume = captureResume();
      const result: OrderWallsArchiveResult = { kind: 'snapshot', segments, status, watermark, head: watermarkHead,
        cursor: after, pages, bytes, projector, resume };
      options.onUpdate?.(sentInitial ? { ...result, kind: 'patch', patches: [] } : result);
      return result;
    }
    const { response, body, bytes: pageBytes, responseHeadersMs, bodyReadMs: responseBodyReadMs, jsonParseMs, attempts } = fetched;
    bytes += pageBytes;
    batchBytes += pageBytes;
    if (isRecord(body) && isRecord(body.coverage) && body.coverage.status === 'unavailable') {
      const page = body as unknown as OrderWallsArchivePage;
      if (isArchiveProfileStatus(page.profileStatus)) profileStatus = page.profileStatus;
      validateUnavailableIdentity(page, profile, queryRequest);
      const preserved = projector.snapshot(), partialAfterProgress = pages > 0;
      const unavailable = archiveStatus(request, availability, partialAfterProgress ? 'partial' : 'unavailable', page.coverage);
      unavailable.exact = false;
      unavailable.requestComplete = true;
      if (profileStatus) unavailable.profileStatus = profileStatus;
      const message = page.coverage.reason ?? 'The requested archive interval is unavailable.';
      const status = statusForArchive(unavailable, partialAfterProgress ? 'partial' : 'unavailable', message);
      const result: OrderWallsArchiveResult = { kind: 'snapshot', segments: preserved, status, watermark: validInt(page.watermark) ? page.watermark : undefined, head: watermarkHead, pages: pages + 1, bytes, projector };
      options.onUpdate?.(pages ? { ...result, kind: 'patch', patches: [] } : result); return result;
    }
    const validationStartedAt = performance.now();
    const page = validatePage(body, profile, queryRequest, after, watermark, watermarkHead);
    const validationMs = performance.now() - validationStartedAt + ('validationMs' in fetched?Number(fetched.validationMs??0):0);
    if (page.profileStatus) profileStatus = page.profileStatus;
    if (watermark === undefined) { watermark = page.watermark; watermarkHead = page.head; }
    const fixedAt = watermarkHead?.at;
    const fixedCoverage = fixedAt === undefined ? page.coverage : {
      ...page.coverage,
      confirmedTo: page.coverage.confirmedTo === null ? null : Math.min(page.coverage.confirmedTo ?? fixedAt, fixedAt),
      gaps: page.coverage.gaps.filter(gap => (gap.from ?? gap.at ?? 0) <= fixedAt),
    };
    const replayPage = { ...page, coverage: fixedCoverage, head: page.head ?? watermarkHead } as OrderWallsArchivePage & { head: NonNullable<OrderWallsArchivePage['head']> };
    if (!orderWallsArchiveDerivationsExact(page.profile, settings)) {
      const archive = { ...archiveStatus(request, availability, 'unavailable', page.coverage), exact: false,
        requestComplete: true,
        ...(profileStatus ? { profileStatus } : {}) };
      const status = statusForArchive(archive, 'unavailable', 'The server profile cannot exactly derive the requested Top Levels settings.');
      const segments = projector.snapshot();
      const result: OrderWallsArchiveResult = { kind: 'snapshot', segments, status, watermark, pages: pages + 1, bytes, projector };
      options.onUpdate?.(pages ? { ...result, kind: 'patch', patches: [] } : result); return result;
    }
    pages++;
    batchPages++;
    patchCount += page.patches.length;
    pageCoverage = mergeCoverage(pageCoverage, fixedCoverage);
    if (page.patches.length) lastMidpoint = page.patches.at(-1)!.midpoint;
    else if (page.seed) lastMidpoint = page.seed.midpoint;
    const projectionStartedAt = performance.now();
    const changed = projector.applyPage(replayPage);
    const projectorApplyMs = performance.now() - projectionStartedAt;
    const serverState = coverageState(pageCoverage.status);
    const locallyLimited = projector.historyLimited && !page.page.hasMore;
    const extentCovered = pageCoverage.availableFrom !== null && pageCoverage.availableFrom <= request.from
      && pageCoverage.confirmedTo !== null && pageCoverage.confirmedTo >= request.to - 1;
    const sourceCoveragePartial = pageCoverage.status !== 'complete' || pageCoverage.partial || pageCoverage.gaps.length > 0 || pageCoverage.gapsTruncated === true;
    const rangeComplete = extentCovered && !sourceCoveragePartial;
    const summaryState = page.page.hasMore ? 'loading'
      : serverState === 'complete' && (locallyLimited || sourceCoveragePartial || !extentCovered) ? 'partial' : serverState;
    const archive = { ...archiveStatus(request, availability, summaryState, pageCoverage), exact: true,
      ...(profileStatus ? { profileStatus } : {}),
      market: page.profile.market, feed: page.profile.feed, aggregation: page.profile.aggregation,
      profileVersion: page.profile.version, algorithmVersion: page.profile.algorithmVersion, schemaVersion: page.profile.schemaVersion,
      midpoint: lastMidpoint, requestComplete: !page.page.hasMore, rangeComplete,
      ...(page.page.hasMore ? { resumeAfter: page.page.nextAfter } : {}) };
    archive.loadedThrough = projector.confirmedAt;
    if (locallyLimited) archive.reason = 'Local archive projection reached its bounded history capacity.';
    else if (!page.page.hasMore && !extentCovered && serverState === 'complete') archive.reason = 'The archive source did not confirm the full requested time extent.';
    const status = statusForArchive(archive, summaryState, pageCoverage.reason ?? archive.reason);
    lastStatus = status;
    if (projector.valueRunsLimited) status.valueHistoryLimited = true;
    if (projector.episodesLimited) status.episodeHistoryLimited = true;
    const update: OrderWallsArchiveUpdate = sentInitial
      ? { kind: 'patch', patches: changed, status, watermark, head: watermarkHead, cursor: page.page.nextAfter, pages, bytes, projector,
        ...(page.page.hasMore ? { resume: captureResume(page.page.nextAfter) } : {}) }
      : { kind: 'snapshot', segments: projector.snapshot(), status, watermark, head: watermarkHead, cursor: page.page.nextAfter, pages, bytes, projector,
        ...(page.page.hasMore ? { resume: captureResume(page.page.nextAfter) } : {}) };
    sentInitial = true;
    const updateStartedAt = performance.now();
    options.onUpdate?.(update);
    const updateCallbackMs = performance.now() - updateStartedAt;
    const requestedAfter = after;
    if (page.page.hasMore && page.page.nextAfter <= after) throw new Error('Order Walls archive cursor did not advance');
    if (page.page.hasMore) after = page.page.nextAfter;
    let eventLoopYieldDelayMs = 0;
    if (page.page.hasMore && (batchPages >= ORDER_WALL_ARCHIVE_YIELD_MAX_PAGES || batchBytes >= ORDER_WALL_ARCHIVE_YIELD_MAX_BYTES
      || performance.now() - batchStartedAt >= ORDER_WALL_ARCHIVE_YIELD_MAX_MS)) {
      const yieldStartedAt = performance.now();
      await yieldArchiveBatch(signal);
      eventLoopYieldDelayMs = performance.now() - yieldStartedAt;
      batchPages = 0; batchBytes = 0; batchStartedAt = performance.now();
    }
    options.onPageMetrics?.({viewId,requestId:response.headers.get('x-iq-request-id')??undefined,dbQueries:Number(response.headers.get('x-iq-db-queries')??0),dbReadRows:Number(response.headers.get('x-iq-db-read-rows')??0),dbReadBytes:Number(response.headers.get('x-iq-db-read-bytes')??0),encodedBytes:Number(response.headers.get('content-length')??0), requestedAfter, pageAfter: page.page.after, nextAfter: page.page.nextAfter,
      patchCount: page.patches.length, responseBytes: pageBytes, responseHeadersMs, responseBodyReadMs,
      jsonParseMs, validationMs, projectorApplyMs, updateCallbackMs, eventLoopYieldDelayMs, attempts });
    if (!page.page.hasMore) return { kind: 'snapshot', segments: projector.snapshot(), status, watermark, head: watermarkHead, cursor: page.page.nextAfter, pages, bytes, projector };
  }} finally {prepared?.dispose();}
}

/** Polls only bounded selected-profile changes; it never replays or projects the browser's 5k raw book. */
export class OrderWallsArchiveCurrentPoller {
  private after: number;
  private timer?: ReturnType<typeof setTimeout>;
  private abort?: AbortController;
  private stopped = true;
  private busy = false;
  private failures = 0;
  private watermark?: number;
  private synced = false;
  readonly stats = { polls: 0, pages: 0, patches: 0, bytes: 0, failures: 0, yieldedPolls: 0, lastPollMs: 0, cursor: 0 };

  constructor(private readonly options: OrderWallsArchiveCurrentPollerOptions) {
    this.after = options.request.after;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.abort = new AbortController();
    void this.poll();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer); this.timer = undefined;
    this.abort?.abort(); this.abort = undefined;
  }

  private async poll() {
    if (this.stopped || this.busy) return;
    this.busy = true;
    this.stats.polls++;
    const started = (this.options.now ?? Date.now)();
    const abort = this.abort ?? new AbortController(); this.abort = abort;
    let watermark: number | undefined, yielded = false;
    let pagesThisPoll = 0;
    const bytesAtStart = this.stats.bytes;
    const maxPages = Math.max(1, Math.min(ORDER_WALL_ARCHIVE_CURRENT_MAX_PAGES_PER_POLL,
      Math.floor(this.options.maxPagesPerPoll ?? ORDER_WALL_ARCHIVE_CURRENT_MAX_PAGES_PER_POLL)));
    try {
      const expected = expectedProfileFromCurrent(this.options.request);
      let page = await readCurrentPage(this.options.request, this.after, undefined, abort.signal, this.options.fetcher);
      if (this.after > 0 && page.watermark < this.after) {
        const reason = 'Order Walls profile cursor reset; a new current state is required.';
        this.options.onReset?.(reason);
        this.after = 0; this.watermark = undefined;
        page = await readCurrentPage(this.options.request, 0, undefined, abort.signal, this.options.fetcher);
      }
      watermark = page.watermark;
      let watermarkHead: NonNullable<OrderWallsArchiveCurrentPage['head']> | undefined;
      for (;;) {
        validateCurrentPage(page, expected, this.after, watermark, watermarkHead);
        if (!watermarkHead) watermarkHead = page.head;
        if (!watermarkHead) throw new Error('Order Walls current page omitted its fixed-watermark head');
        const normalizedPage = page.head === watermarkHead ? page : { ...page, head: watermarkHead };
        if (normalizedPage.coverage) {
          normalizedPage.coverage = {
            ...normalizedPage.coverage,
            // The head is fixed for this whole response batch, but a partial
            // page has only consumed patches through its own last event.
            confirmedTo: Math.min(normalizedPage.coverage.confirmedTo ?? watermarkHead.at,
              normalizedPage.page.hasMore ? normalizedPage.page.lastAt ?? watermarkHead.at : watermarkHead.at, watermarkHead.at),
            gaps: (normalizedPage.coverage.gaps ?? []).filter(gap => (gap.from ?? gap.at ?? 0) <= watermarkHead!.at),
          };
        }
        this.stats.pages++;
        pagesThisPoll++;
        this.stats.patches += normalizedPage.patches.length;
        this.stats.bytes += (normalizedPage as OrderWallsArchiveCurrentPage & { __bytes?: number }).__bytes ?? 0;
        this.options.onPage(normalizedPage);
        if (!page.page.hasMore) {
          this.after = page.page.nextAfter;
          this.watermark = watermark;
          this.stats.cursor = this.after;
          break;
        }
        this.after = page.page.nextAfter;
        this.stats.cursor = this.after;
        if (pagesThisPoll >= maxPages || this.stats.bytes - bytesAtStart >= ORDER_WALL_ARCHIVE_CURRENT_MAX_BYTES_PER_POLL) {
          this.watermark = watermark;
          yielded = true;
          this.stats.yieldedPolls++;
          break;
        }
        page = await readCurrentPage(this.options.request, this.after, watermark, abort.signal, this.options.fetcher);
      }
      if (yielded) this.options.onStatus?.({ state: watermarkHead?.valid ? 'catching-up' : 'stale', sourceValid: watermarkHead?.valid,
        message: watermarkHead?.valid ? 'Current selected-profile tail is catching up through bounded cursor batches.' : 'Current source continuity is not confirmed.' });
      else if (!this.synced) {
        this.synced = true;
        const head = watermarkHead!;
        this.options.onSynced?.({ cursor: watermark, at: head.at, epoch: head.epoch });
      }
      this.failures = 0;
      if (!yielded) {
        const sourceValid = watermarkHead?.valid === true;
        if (sourceValid) this.options.onStatus?.({ state: 'ready', sourceValid: true });
        else {
          const unavailable = page.coverage?.status === 'unavailable';
          this.options.onStatus?.({ state: unavailable ? 'unavailable' : 'stale', sourceValid: false,
            message: page.coverage?.reason ?? 'Current source continuity is not confirmed.' });
        }
      }
    } catch (error) {
      if (!abort.signal.aborted && !this.stopped) {
        this.failures++; this.stats.failures++;
        const message = errorText(error);
        this.options.onStatus?.({ state: this.failures >= 5 ? 'unavailable' : 'stale', message });
        const wait = Math.min(15_000, 500 * 2 ** Math.min(this.failures - 1, 5));
        this.busy = false;
        this.timer = setTimeout(() => void this.poll(), wait);
        return;
      }
    } finally {
      this.stats.lastPollMs = Math.max(0, (this.options.now ?? Date.now)() - started);
      this.busy = false;
    }
    if (!this.stopped) this.timer = setTimeout(() => void this.poll(), yielded ? 0 : this.options.intervalMs ?? 1_000);
  }
}

export async function readCurrentOrderWallsArchivePage(request: OrderWallsArchiveCurrentRequest,
  after = request.after, watermark?: number, signal?: AbortSignal, fetcher: typeof fetch = (...args) => fetch(...args)) {
  return readCurrentPage(request, after, watermark, signal, fetcher);
}

function isArchiveProfileStatus(value: unknown): value is NonNullable<OrderWallsArchivePage['profileStatus']> {
  return value === 'building' || value === 'backfilling' || value === 'ready' || value === 'unavailable';
}

class OrderWallsArchivePageRequestError extends Error {
  constructor(message: string, readonly attempts: number) {
    super(message);
    this.name = 'OrderWallsArchivePageRequestError';
  }
}

async function fetchArchivePageWithRetry(fetcher: typeof fetch, url: string, after: number, signal?: AbortSignal) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ORDER_WALL_ARCHIVE_PAGE_MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw abortError();
    const fetchStartedAt = performance.now();
    try {
      const timeout = AbortSignal.timeout(ORDER_WALL_ARCHIVE_PAGE_TIMEOUT_MS);
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const response = await fetcher(url, { signal: requestSignal });
      const responseHeadersMs = performance.now() - fetchStartedAt;
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        await response.body?.cancel().catch(() => undefined);
        lastError = new Error(`HTTP ${response.status}`);
        if (attempt === ORDER_WALL_ARCHIVE_PAGE_MAX_ATTEMPTS) {
          throw new OrderWallsArchivePageRequestError(errorText(lastError), attempt);
        }
        await waitArchiveRetry(ORDER_WALL_ARCHIVE_RETRY_DELAYS_MS[attempt - 1], signal);
        continue;
      }
      const { body, bytes, bodyReadMs, jsonParseMs } = await readBoundedJson(response,
        ORDER_WALL_ARCHIVE_MAX_BYTES_PER_PAGE, `Order Walls archive HTTP ${response.status}`);
      if (!response.ok) throw new Error(isRecord(body) && typeof body.error === 'string' ? body.error : `Order Walls archive HTTP ${response.status}`);
      return { response, body, bytes, responseHeadersMs, bodyReadMs, jsonParseMs, attempts: attempt };
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (error instanceof OrderWallsArchivePageRequestError) throw error;
      if (!isRetryableArchivePageError(error)) throw error;
      lastError = error;
      if (attempt === ORDER_WALL_ARCHIVE_PAGE_MAX_ATTEMPTS) {
        throw new OrderWallsArchivePageRequestError(errorText(error), attempt);
      }
      await waitArchiveRetry(ORDER_WALL_ARCHIVE_RETRY_DELAYS_MS[attempt - 1], signal);
    }
  }
  throw new OrderWallsArchivePageRequestError(errorText(lastError ?? 'request failed'), ORDER_WALL_ARCHIVE_PAGE_MAX_ATTEMPTS);
}

function isRetryableArchivePageError(error: unknown) {
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) return true;
  return error instanceof Error && /timeout|timed out|network|fetch failed/i.test(error.message);
}

function waitArchiveRetry(delayMs: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function readBoundedJson(response: Response, maxBytes: number, label: string): Promise<{
  body: unknown; bytes: number; bodyReadMs: number; jsonParseMs: number;
}> {
  const declaredBytes = Number(response.headers.get('content-length') ?? 0);
  if (declaredBytes > maxBytes) throw new Error(`${label} exceeded its response-size limit`);
  if (!response.body) {
    const bodyReadStartedAt = performance.now();
    const text = await response.text();
    const bodyReadMs = performance.now() - bodyReadStartedAt;
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > maxBytes) throw new Error(`${label} exceeded its response-size limit`);
    const jsonParseStartedAt = performance.now();
    try { const body = JSON.parse(text); return { body, bytes, bodyReadMs, jsonParseMs: performance.now() - jsonParseStartedAt }; }
    catch { throw new Error(`${label} returned invalid JSON`); }
  }

  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0, bodyReadStartedAt = performance.now();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error(`${label} exceeded its response-size limit`);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  const bodyReadMs = performance.now() - bodyReadStartedAt;
  const jsonParseStartedAt = performance.now();
  try { const body = JSON.parse(new TextDecoder().decode(merged)); return { body, bytes, bodyReadMs, jsonParseMs: performance.now() - jsonParseStartedAt }; }
  catch { throw new Error(`${label} returned invalid JSON`); }
}

function yieldArchiveBatch(signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true; signal?.removeEventListener('abort', onAbort); resolve();
    }, 0);
    const onAbort = () => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function readCurrentPage(request: OrderWallsArchiveCurrentRequest, after: number, watermark: number | undefined,
  signal: AbortSignal | undefined, fetcher: typeof fetch = (...args) => fetch(...args)) {
  const params = new URLSearchParams({ profile: request.profile, market: request.market, after: String(after),
    limit: String(Math.max(1, Math.min(ORDER_WALL_ARCHIVE_PAGE_LIMIT, Math.floor(request.limit ?? ORDER_WALL_ARCHIVE_PAGE_LIMIT)))) });
  if (watermark !== undefined) params.set('watermark', String(watermark));
  const response = await fetcher(`/market-data/v1/order-walls/archive/current?${params}`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
  });
  const declaredBytes = Number(response.headers.get('content-length') ?? 0);
  if (declaredBytes > ORDER_WALL_ARCHIVE_CURRENT_MAX_BYTES_PER_PAGE) throw new Error('Order Walls current page exceeded its response-size limit');
  let body: unknown, bytes: number;
  try {
    const text = await response.text();
    bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > ORDER_WALL_ARCHIVE_CURRENT_MAX_BYTES_PER_PAGE) throw new Error('Order Walls current page exceeded its response-size limit');
    body = JSON.parse(text);
  } catch (error) {
    if (error instanceof Error && error.message.includes('response-size limit')) throw error;
    throw new Error(`Order Walls current HTTP ${response.status} returned invalid JSON`);
  }
  if (!response.ok) throw new Error(isRecord(body) && typeof body.error === 'string' ? body.error : `Order Walls current HTTP ${response.status}`);
  if (isRecord(body)) (body as Record<string, unknown>).__bytes = declaredBytes || bytes;
  return body as OrderWallsArchiveCurrentPage;
}

function expectedProfileFromCurrent(request: OrderWallsArchiveCurrentRequest): ExpectedArchiveProfile {
  return { id: request.profile, market: request.market, instrument: request.instrument, feed: preparedDepthFeed(request.market),
    aggregation: request.aggregation, bandPercent: request.bandPercent,
    confirmationMs: request.confirmationMs ?? 0, selectionTopN: request.selectionTopN ?? 10,
    minimumNotionalUsd: request.minimumNotionalUsd ?? null };
}

function validateCurrentPage(page: OrderWallsArchiveCurrentPage, expected: ExpectedArchiveProfile, after: number, watermark: number,
  expectedHead?: NonNullable<OrderWallsArchiveCurrentPage['head']>) {
  const head = page.head;
  if (!page || page.version !== 1 || !profileBasisMatches(page.profile, expected) || page.market !== expected.market
    || page.instrument !== expected.instrument || page.feed !== expected.feed || !validInt(page.watermark) || page.watermark !== watermark
    || !head || typeof head.valid !== 'boolean'
    || !expectedHead && (!validInt(head.cursor) || head.cursor !== page.watermark || !validInt(head.epoch)
      || !finiteNonNegative(head.at) || !(head.midpoint === null || validDecimal(head.midpoint)))
    || expectedHead && !sameCurrentHead(head, expectedHead)
    || !page.page || page.page.after !== after || !validInt(page.page.after) || !validInt(page.page.nextAfter)
    || !(page.page.lastAt === null || finiteNonNegative(page.page.lastAt)) || !validInt(page.page.limit)
    || typeof page.page.hasMore !== 'boolean' || page.page.hasMore && page.page.lastAt === null || page.page.sameMillisecondClosed !== true
    || !Array.isArray(page.patches)
    || page.profileStatus !== undefined && !isArchiveProfileStatus(page.profileStatus)) throw new Error('Invalid Order Walls current page contract');
  if (after === 0) {
    if (!page.state || !Array.isArray(page.state.bids) || !Array.isArray(page.state.asks) || page.patches.length
      || page.page.hasMore || page.page.nextAfter !== watermark
      || !page.state.bids.every(candidate => validCandidate(candidate) && candidate.side === 'bid')
      || !page.state.asks.every(candidate => validCandidate(candidate) && candidate.side === 'ask')) throw new Error('Invalid Order Walls current bootstrap state');
    return;
  }
  if (page.state !== undefined) throw new Error('Order Walls current delta page must not replace its bootstrap state');
  let previousCursor = after;
  for (const patch of page.patches) {
    if (!validArchivePatch(patch) || patch.cursor <= after || patch.cursor <= previousCursor || patch.cursor > watermark) throw new Error('Invalid Order Walls current patch ordering');
    if ([...patch.bids.upserts, ...patch.asks.upserts].some(candidate => candidate.confirmationAt !== undefined
      && candidate.confirmationAt !== null && candidate.confirmationAt > patch.at)) throw new Error('Order Walls current candidate confirmation exceeds its observation time');
    previousCursor = patch.cursor;
  }
  if (page.page.hasMore) {
    if (!page.patches.length || page.page.nextAfter !== page.patches.at(-1)!.cursor || page.page.nextAfter <= after) throw new Error('Invalid Order Walls current continuation cursor');
  } else if (page.page.nextAfter !== watermark) throw new Error('Invalid Order Walls current final cursor');
}

function sameCurrentHead(a: NonNullable<OrderWallsArchiveCurrentPage['head']>, b: NonNullable<OrderWallsArchiveCurrentPage['head']>) {
  return a.cursor === b.cursor && a.at === b.at && a.epoch === b.epoch && a.midpoint === b.midpoint
    && a.valid === b.valid
    && canonicalJson(a.bookScope ?? null) === canonicalJson(b.bookScope ?? null);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? String(value);
}

function validArchivePatch(value: unknown): value is OrderWallsArchivePatch {
  return isRecord(value) && ['patch', 'gap'].includes(String(value.kind)) && validInt(value.cursor) && validInt(value.epoch)
    && finiteNonNegative(value.at) && (value.midpoint === null || validDecimal(value.midpoint))
    && validSidePatch(value.bids) && validSidePatch(value.asks) && (value.kind !== 'gap' || typeof value.reason === 'string');
}

interface ExpectedArchiveProfile {
  id: string;
  market: 'spot' | 'perpetual';
  instrument: string;
  feed: string;
  aggregation: string;
  bandPercent: number;
  confirmationMs: number;
  selectionTopN: number;
  minimumNotionalUsd: string | null;
}

function validatePage(body: unknown, expected: ExpectedArchiveProfile, request: OrderWallsArchiveRequest,
  after: number, watermark?: number, expectedHead?: NonNullable<OrderWallsArchivePage['head']>): OrderWallsArchivePage {
  if (!isRecord(body)) throw new Error('Invalid Order Walls archive page contract');
  const page = body as unknown as OrderWallsArchivePage;
  const head = page.head;
  const establishesWatermark = watermark === undefined;
  const effectiveAfter = after === 0 ? page.page?.after : after;
  if (page.version !== 1 || !profileBasisMatches(page.profile, expected)
    || page.market !== expected.market || page.instrument !== expected.instrument || page.feed !== expected.feed || page.profile.feed !== expected.feed
    || page.from !== request.from || page.to !== request.to || !validInt(page.watermark)
    || watermark !== undefined && page.watermark !== watermark
    || establishesWatermark && (!head || head.cursor !== page.watermark || !validInt(head.cursor) || !validInt(head.epoch) || !finiteNonNegative(head.at))
    || !establishesWatermark && (head !== undefined && (!expectedHead || head.cursor !== expectedHead.cursor || head.at !== expectedHead.at || head.epoch !== expectedHead.epoch))
    || !establishesWatermark && !head && !expectedHead
    || !page.page || after !== 0 && page.page.after !== after || !validInt(page.page.after) || !validInt(page.page.nextAfter)
    || page.page.after > page.watermark || !validInt(page.page.nextAfter)
    || !finiteNonNegative(page.page.lastAt) || !validInt(page.page.limit)
    || page.page.sameMillisecondClosed !== true || !Array.isArray(page.patches)
    || !page.coverage || !Array.isArray(page.coverage.gaps)
    || page.profileStatus !== undefined && !isArchiveProfileStatus(page.profileStatus)
    || page.coverage.requestedFrom !== request.from || page.coverage.requestedTo !== request.to
    || !['building', 'backfilling', 'complete', 'partial', 'unavailable'].includes(page.coverage.status)) throw new Error('Invalid Order Walls archive page contract');
  if (after === 0 && page.seed && page.page.after < page.seed.cursor) throw new Error('Order Walls archive page cursor precedes its carry-in seed');
  if (!validInt(effectiveAfter)) throw new Error('Invalid Order Walls archive start cursor');
  let previousCursor = effectiveAfter;
  for (const patch of page.patches) {
    if (!isRecord(patch) || !['patch', 'gap'].includes(patch.kind) || !validInt(patch.cursor) || patch.cursor <= effectiveAfter
      || patch.cursor <= previousCursor || patch.cursor > page.watermark || !validInt(patch.epoch) || !finiteNonNegative(patch.at)
      || !(patch.midpoint === null || validDecimal(patch.midpoint)) || !validSidePatch(patch.bids) || !validSidePatch(patch.asks)) {
      throw new Error('Invalid Order Walls archive patch ordering or candidate data');
    }
    if (patch.kind === 'gap' && typeof patch.reason !== 'string') throw new Error('Order Walls archive gap has no reason');
    previousCursor = patch.cursor;
  }
  const expectedNextAfter = page.page.hasMore ? page.patches.at(-1)?.cursor : page.watermark;
  if (expectedNextAfter === undefined || page.page.nextAfter !== expectedNextAfter
    || page.page.hasMore && page.page.nextAfter <= effectiveAfter) throw new Error('Invalid Order Walls archive continuation cursor');
  if (page.seed !== undefined && (!validInt(page.seed.cursor) || !validInt(page.seed.epoch) || !finiteNonNegative(page.seed.at)
    || !(page.seed.midpoint === null || validDecimal(page.seed.midpoint)) || !Array.isArray(page.seed.bids) || !Array.isArray(page.seed.asks)
    || !page.seed.bids.every(candidate => validCandidate(candidate) && candidate.side === 'bid')
    || !page.seed.asks.every(candidate => validCandidate(candidate) && candidate.side === 'ask'))) throw new Error('Invalid Order Walls archive carry-in seed');
  if (after === 0 && page.seed && page.seed.at > request.from) throw new Error('Order Walls archive carry-in seed is after the requested start');
  for (const patch of page.patches) for (const candidate of [...patch.bids.upserts, ...patch.asks.upserts]) {
    if (candidate.confirmationAt !== undefined && candidate.confirmationAt !== null && candidate.confirmationAt > patch.at) {
      throw new Error('Order Walls archive candidate confirmation exceeds its observation time');
    }
  }
  return page;
}

function validateUnavailableIdentity(page: OrderWallsArchivePage, expected: ExpectedArchiveProfile, request: OrderWallsArchiveRequest) {
  if (!page.profile || !profileBasisMatches(page.profile, expected) || page.market !== expected.market || page.instrument !== expected.instrument
    || page.feed !== expected.feed || page.profile.feed !== expected.feed
    || page.from !== request.from || page.to !== request.to || !page.coverage || page.coverage.requestedFrom !== request.from
    || page.coverage.requestedTo !== request.to) throw new Error('Invalid unavailable Order Walls archive response identity');
}

function profileBasisMatches(profile: OrderWallsArchiveProfile, expected: ExpectedArchiveProfile) {
  return Boolean(profile && profile.id === expected.id && profile.version === 1 && profile.venue === 'binance'
    && profile.market === expected.market && profile.instrument === expected.instrument && profile.feed === expected.feed
    && profile.aggregation === expected.aggregation && profile.bandPercent === expected.bandPercent
    && profile.midpointBasis === 'best-observed-bid-ask' && profile.topN === 10
    && profile.algorithmVersion === 1 && profile.schemaVersion === 1
    && profile.confirmationMs === expected.confirmationMs && profile.selectionTopN === expected.selectionTopN
    && profile.minimumNotionalUsd === expected.minimumNotionalUsd);
}
export function orderWallsArchiveDerivationsExact(profile: OrderWallsArchiveProfile, settings: OrderWallsSettings) {
  const common = Array.isArray(profile.exactDerivations?.bandPercent) && profile.exactDerivations.bandPercent.includes(settings.searchRangePercent)
    && profile.exactDerivations.minimumNotional === true && profile.exactDerivations.confirmation === true;
  if (!common) return false;
  if (settings.minDurationMs === 0) return profile.confirmationMs === 0 && profile.selectionTopN === 10
    && profile.minimumNotionalUsd === null && profile.exactDerivations.topNMax >= settings.topLevels;
  const requestedMinimum = settings.minimumNotionalEnabled ? archiveDecimal(settings.minimumNotionalUsd) : null;
  return profile.confirmationMs === settings.minDurationMs && profile.selectionTopN === settings.topLevels
    && profile.minimumNotionalUsd === requestedMinimum && profile.exactDerivations.confirmationCrossings === true;
}

function validSidePatch(value: unknown): value is OrderWallsArchiveSidePatch {
  return isRecord(value) && Array.isArray(value.upserts) && value.upserts.every(validCandidate)
    && Array.isArray(value.removals) && value.removals.every(validRemoval);
}
function validCandidate(value: unknown): value is OrderWallsArchiveCandidate {
  if (!isRecord(value)) return false;
  return typeof value.entryId === 'string' && value.entryId.length > 0 && (value.side === 'bid' || value.side === 'ask')
    && validDecimal(value.price) && decimalNumber(value.price) > 0 && validDecimal(value.quantity) && validDecimal(value.notional)
    && validInt(value.rank) && value.rank >= 1 && value.rank <= 10 && finiteNonNegative(value.startedAt)
    && validInt(value.startCursor) && validInt(value.startEpoch) && typeof value.startKnown === 'boolean'
    && (value.confirmationAt === undefined || value.confirmationAt === null || finiteNonNegative(value.confirmationAt));
}
function validRemoval(value: unknown): value is OrderWallsArchiveRemoval {
  if (!isRecord(value)) return false;
  return typeof value.entryId === 'string' && value.entryId.length > 0 && (value.side === 'bid' || value.side === 'ask')
    && validDecimal(value.price) && finiteNonNegative(value.at) && validInt(value.cursor) && validInt(value.epoch)
    && ['band-exit', 'rank-exit', 'below-minimum', 'observed-zero', 'gap', 'replacement-epoch', 'capacity-unknown'].includes(String(value.reason))
    && finiteNonNegative(value.lastConfirmedAt) && validInt(value.lastConfirmedCursor);
}

function archiveStatus(request: OrderWallsArchiveRequest, availability: OrderWallsArchiveAvailability,
  state: OrderWallArchiveStatus['state'], coverage?: OrderWallsArchiveCoverage): OrderWallArchiveStatus {
  const gaps = (coverage?.gaps ?? []).map(gap => ({ from: gap.from ?? gap.at ?? request.from,
    to: gap.to ?? gap.at ?? gap.from ?? request.to, reason: gap.reason }));
  return {
    profileId: availability.profileId ?? request.profileId ?? '', state, from: request.from, to: request.to,
    rangeComplete: Boolean(coverage && coverage.status === 'complete' && !coverage.partial && !coverage.gaps.length && !coverage.gapsTruncated
      && coverage.availableFrom !== null && coverage.availableFrom <= request.from
      && coverage.confirmedTo !== null && coverage.confirmedTo >= request.to - 1),
    market: availability.market, feed: availability.market ? preparedDepthFeed(availability.market) : undefined,
    aggregation: orderWallsSettings(request.settings).aggregation === 'native' ? 'native' : `${orderWallsSettings(request.settings).aggregation}usdt`,
    ...(coverage?.availableFrom !== undefined && coverage.availableFrom !== null ? { availableFrom: coverage.availableFrom } : {}),
    ...(coverage?.confirmedTo !== undefined && coverage.confirmedTo !== null ? { confirmedTo: coverage.confirmedTo } : {}),
    gaps, ...(coverage?.gapsTruncated ? { gapsTruncated: true } : {}), requestedBandPercent: availability.requestedBandPercent,
    profileBandPercent: orderWallsSettings(request.settings).searchRangePercent,
    requestedTopN: orderWallsSettings(request.settings).topLevels, exact: availability.exact,
    ...(coverage?.reason || availability.reason ? { reason: coverage?.reason ?? availability.reason } : {}),
  };
}

function statusForArchive(archive: OrderWallArchiveStatus, state: OrderWallArchiveStatus['state'], message?: string): OrderWallStatus {
  const complete = state === 'complete';
  const unavailable = state === 'unavailable';
  const coverage = { from: archive.from, to: archive.to, complete, partial: !complete,
    ...(archive.reason || message ? { reason: archive.reason ?? message } : {}) };
  const statusState: OrderWallStatus['state'] = unavailable ? 'unavailable' : state === 'loading' || state === 'building' || state === 'backfilling'
    ? 'loading' : state === 'partial' ? 'gap' : 'stale';
  return { state: statusState, ...(message || archive.reason ? { message: message ?? archive.reason } : {}), coverage, archive: { ...archive, state } };
}

function mergeCoverage(previous: OrderWallsArchiveCoverage | undefined, next: OrderWallsArchiveCoverage): OrderWallsArchiveCoverage {
  if (!previous) return next;
  const gaps = new Map<string, OrderWallsArchiveCoverage['gaps'][number]>();
  for (const gap of [...previous.gaps, ...next.gaps]) gaps.set(`${gap.from ?? gap.at}:${gap.to ?? gap.at}:${gap.reason}`, gap);
  return { ...previous, ...next, bookScope: next.bookScope ?? previous.bookScope, gaps: [...gaps.values()] };
}

function expectedProfile(request: OrderWallsArchiveRequest, settings: OrderWallsSettings, availability: OrderWallsArchiveAvailability): ExpectedArchiveProfile {
  const market = request.market === 'binance-spot' ? 'spot' : 'perpetual';
  return {
    id: request.profileId ?? availability.profileId ?? orderWallsArchiveProfileId(request.market, settings) ?? '',
    market,
    instrument: market === 'spot' ? 'binance:spot:BTCUSDT' : 'binance:perpetual:BTCUSDT',
    feed: preparedDepthFeed(market),
    aggregation: settings.aggregation === 'native' ? 'native' : `${settings.aggregation}usdt`,
    bandPercent: settings.searchRangePercent,
    confirmationMs: settings.minDurationMs,
    selectionTopN: settings.minDurationMs === 0 ? 10 : settings.topLevels,
    minimumNotionalUsd: settings.minDurationMs > 0 && settings.minimumNotionalEnabled
      ? archiveDecimal(settings.minimumNotionalUsd) : null,
  };
}

function coverageState(value: string): OrderWallArchiveStatus['state'] {
  if (value === 'building' || value === 'backfilling' || value === 'unavailable') return value;
  return value === 'complete' ? 'complete' : 'partial';
}

function canonicalPercent(value: number) {
  return Number(value.toPrecision(12)).toString().replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function archiveDecimal(value: number) {
  return expandExponent(value.toString()).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function archiveUsdSlug(value: number) { return archiveDecimal(value).replace('.', '_'); }

function compareDecimalToNumber(decimal: string, value: number) {
  const threshold = expandExponent(value.toString());
  const [leftWhole, leftFraction = ''] = decimal.split('.');
  const [rightWhole, rightFraction = ''] = threshold.split('.');
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const left = BigInt(`${leftWhole}${leftFraction.padEnd(scale, '0')}` || '0');
  const right = BigInt(`${rightWhole}${rightFraction.padEnd(scale, '0')}` || '0');
  return left < right ? -1 : left > right ? 1 : 0;
}

function expandExponent(value: string) {
  if (!/[eE]/.test(value)) return value;
  const [mantissa, exponentText] = value.toLowerCase().split('e');
  const exponent = Number(exponentText), negative = mantissa!.startsWith('-');
  const unsigned = negative ? mantissa!.slice(1) : mantissa!;
  const [whole, fraction = ''] = unsigned.split('.'), digits = whole + fraction, decimalAt = whole.length + exponent;
  const expanded = decimalAt <= 0 ? `0.${'0'.repeat(-decimalAt)}${digits}`
    : decimalAt >= digits.length ? `${digits}${'0'.repeat(decimalAt - digits.length)}`
      : `${digits.slice(0, decimalAt)}.${digits.slice(decimalAt)}`;
  return `${negative ? '-' : ''}${expanded}`;
}
function validDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}
function decimalNumber(value: string) { return Number(value); }
function validInt(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function finiteNonNegative(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function isRecord(value: unknown): value is Record<string, any> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function abortError() { return new DOMException('Order Walls archive request aborted', 'AbortError'); }

