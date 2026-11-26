# Raw OI resident history foundation

The client now separates explicitly retained historical observation windows from its rolling live horizon. This foundation is reused by [optional historical reads](raw-open-interest-history-client.md). Ordinary builds do not request the historical route. The backend gateway remains disabled and undeployed.

## Cache ownership and bounds

`RawOpenInterestHistory` still defaults to four hours and 2,000 tracked native keys. Historical admission requires explicit constructor options; the optional `VITE_OI_HISTORY=1` integration selects 15 windows, while ordinary application callers retain the live-only defaults. The hard optional limits are 32,000 tracked keys and 16 windows, each at most four hours. Conflicting-version notices count toward the same key limit. Constructor and window validation refuse larger or contradictory bounds.

```ts
const history = new RawOpenInterestHistory({maxObservations: 32_000, maxWindows: 16});
history.merge({to, observations, conflicts}, {window: {key, from, to}});
```

Window identity fixes its original range. Loaded windows survive live updates, delayed response ordering and compatible controller resubscription snapshots. Historical admission does not advance or rewind the live horizon. Recent live keys receive priority during capacity eviction. Window admission/refresh orders eviction; overlapping ownership retains shared rows. Eviction scans are bounded passes, not repeated whole-map copying per evicted key. No performance claim follows from that algorithm inspection.

`retainedWindows()` returns copies with a `resident` flag. Capacity eviction marks affected windows nonresident, and an empty/partial later merge cannot clear that marker for the same window identity. This is cache bookkeeping, not proof of complete venue recording or publication coverage. A future demand planner must respect the marker, resource limits and original API coverage rather than treat an admitted range as complete. There is no request-lifecycle release that discards resident windows; context incompatibility, explicit fixture reset, cache policy and owner disposal remain clearing boundaries.

## Native correction and gap semantics

The full native key includes venue, market, native symbol, original epoch and source time. Only a strictly newer `observedAtMs` supersedes a known version. Changed content at the same highest version withholds that key; repeated old/equal payloads cannot resurrect it. A newer original version can resolve it. This is the highest known version among retained inputs, not independent financial/current-source authority.

Accepted rows are copied and frozen. Exact decimal strings and original epoch/quality/provenance/gap fields survive. The payload validator now bounds exact decimal text, rejects non-finite or zero exact quantities and accepts a legitimate original epoch of zero, matching the backend contract. It never manufactures an epoch or quantity.

Worker snapshots/patches carry bounded full-key conflict notices, including a conflict with no changed accepted row. A chart replica therefore withholds its previous value rather than silently retaining it. Projection uses the host candle timeline with the original 75-second sample freshness ceiling; it no longer independently discards explicitly retained rows merely because they are older than four hours today. Conflicting timestamps form projection barriers: a preceding fresh level cannot be carried through the withheld sample. Original source gaps and epoch boundaries still create reset segments.

Ordinary live snapshots merge. An explicit development fixture snapshot carries `reset:true`, preserving fixture replacement without turning network resubscription into a cache clear. Incompatible market/instrument context and disposal still release data. Unit verification remains required for plotted values; retaining a row does not supply missing verification or extend observation freshness.

[Validation evidence](evidence/raw-open-interest-resident-validation.json) records commands, source hashes and scope limits.

## Verification and remaining work

- 27 focused Vitest cases across existing raw OI and new resident-history tests pass. Cases include full 32,000-key capacity, overlap eviction, live priority, conflict replicas, decimal bounds, zero epoch, historical as-of freshness and controller resubscription/reset.
- Typecheck runs as the `tsc --noEmit` stage of `VITE_DIAGNOSTICS=1 pnpm build`; the build passes.
- The existing `open-interest-sma.spec.ts` headless Chromium fixture passes against an isolated preview of this checkout. It covers chart-scoped OI/SMA ownership and lifecycle, not real historical archive retrieval or foreground Pi performance.

The [optional integration](raw-open-interest-history-client.md) now adds validated observed/publication-as-of payloads, bounded worker demand, shared requests, retry budgets and per-range coverage. It remains unselected by default. Original archive-only unit proof, automatic source-time correction resealing, provider qualification and production deployment remain open. The broader storage goal still requires live ingestion/archive coexistence and foreground Raspberry Pi p50/p95 acceptance.
