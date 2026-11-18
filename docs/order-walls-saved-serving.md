# Saved Order Walls on staging

The staging client now sends prepared wall discovery, source checks and projection
reads through local port 18882, and reader leases/cancellation through 18883.
Both forward to the dedicated gateway on staging port 18892. Other feeds retain
their existing routes. `pnpm tunnel:staging` creates all four transports;
`pnpm dev:staging` selects the wall routes and newest-first prepared delivery.
The two VITE_WALL_HISTORY_API_URL / VITE_WALL_CONTROL_API_URL overrides must be
configured together and use unauthenticated loopback HTTP origins.

The service uses the existing merged backend application at
`07318748bd2a17fe1f3a6ac917009fd9122f4865`, including persisted projections,
authenticated continuation checkpoints, independent source publication,
revision checks, reader leases and bounded retention. No financial algorithm
was replaced. Rolling defaults prepare the native Top8 / 10% / 30-hour Spot
5-minute and perpetual 15-minute configurations without a chart being open.
Compatible extensions reuse checkpoints and old output; incompatible corrections
or changed starts use the conservative reconstruction path. Custom settings and
unavailable prepared ranges retain the incumbent fallback.

The dedicated containers are `iqterminal-wall-prepared-main-worker` and
`iqterminal-wall-prepared-main-gateway`. Saved files live in the host directory
`/home/daz/iqterminal-wall-prepared-main-v6`, separate from the old service.
Each container has one CPU and 768 MiB RAM; admission accounts for other retained
wall roots within an 8 GiB aggregate derived budget and a 40 GiB free-space floor.
Collectors and the incumbent API were not replaced.

## Operation

From `/home/daz/workarea/iqterminal-server-main`:

```sh
python3 ops/wall-serving.py status
python3 ops/wall-serving.py check
```

The recorded manifest and bundle checksums are under
`artifacts/prepared-wall-serving`. `start` reconciles an already running owned
pair. `stop` requires its recorded session/build/root and retains saved files.
An explicitly stopped session is fenced: use a new `--run-dir` for a later start.
The containers do not automatically restart after host reboot; inspect ownership
and any stale running lock before restarting. Never delete saved data to restart.

For the current activation, the pre-existing 18780/18781 tunnels were retained
and a separate pair was started on 18882/18883. Stop that extra pair before
replacing the standard tunnel process with the new four-lane command.

## Evidence and limits

- Backend: 53 focused continuation, source, tail, rolling-default and gateway
  tests passed; 19 cleanup tests and 3 CLI lifecycle tests passed; build and
  typecheck passed.
- Client: 81 focused projection/routing/tunnel tests and 6 proxy tests passed;
  typecheck/build passed. Two headless browser fixture tests passed.
- Real data through `http://127.0.0.1:5173/market-data`: five-minute Spot
  (17 walls) and perpetual (21 walls) histories matched chronological replay,
  including repeated prepared reads. First prepared loads took 5.90 / 5.04 s;
  reopens took 2.30 / 1.92 s. These include validation and transfer and are not
  foreground frame or full-window paint measurements.
- Both padded 30-hour background projections reached ready state. The source
  contained 13 Spot and 3 perpetual continuity gaps; ready does not mean gap-free.

Evidence: [real comparison](../artifacts/order-walls-newest-first/real-reference.json),
[background snapshot](../artifacts/order-walls-newest-first/serving-background.json),
[saved discovery](../artifacts/order-walls-newest-first/serving-discovery.json).

Initial cold preparation still costs time, and rolling starts or invalidated
source can require reconstruction. This activation establishes saved serving;
it does not establish speed parity with other products. A pooled HTTP request
also exposed a development proxy tracing crash; tracing now avoids mutating
already-sent headers, with a regression test and successful real-route recheck.
