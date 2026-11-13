# Native Pi selected-wall transport comparison

Chromium 155.0.8059.79, Node v22.23.4, Pi arm64. Test windows verified on i3
workspace 9 without focus. Backend fae5c0d0870ef1ffddeb4a1d9f71ee1f559c70d2,
frontend Vite/config source a093b48da1c5ee46a2d373c7ae2d85ae84408ae8.
This page uses native HTTP decoding only; it does not load/paint a chart bundle.

A read-only staging loopback endpoint serves the two exact prepared Spot30h
selected batches. A separate SSH tunnel on 18794 and Vite preview proxy on 4182
forward them to native Chromium. Per-codec proxy routes set the upstream accepted
encoding; the browser natively decodes the corresponding Content-Encoding.
Two batches fetch concurrently as with the prepared loader. Codec order alternates
between runs. Each run creates an empty browser context; cache is disabled by
routing and fetch uses no-store. Server history is already prepared; encoded
cache state/milliseconds are recorded per batch (including initial misses).

All decoded bytes hash identically to pinned reference.json. Total decoded size
13,330,388 bytes. Gzip wire total 1,439,054 bytes; Brotli 1,276,146 (-11.32%).
Every sample, resource snapshot and per-request timing is in samples.json.

| Codec | Five elapsed samples (ms) | Median | Maximum |
| --- | --- | ---: | ---: |
| gzip6 | 3259.7, 1815.8, 2751.6, 3419.1, 3020.4 | 3020.4 | 3419.1 |
| br5 | 1984.2, 1776.9, 2655.4, 3183.6, 2432.4 | 2432.4 | 3183.6 |

Elapsed includes native transfer/decode and SHA validation of both batches.
It excludes discovery, canonical source validation, projector import and chart
paint. It cannot certify the five-second whole-view gate or current freshness.
There is no p95 claim, no synchronization of host wall clocks and no addition
of overlapping request durations. Client resource samples are raw observations;
this is not a full rendering/frame benchmark.

executed.mjs is the exact executed script. The maintained script additionally
bounds each fetch by 15 seconds. The owned Vite preview, browser, SSH tunnel and
staging probe stopped; no incumbent service or collector was restarted. Backend
identity/listener/type/test receipts are in wall-encoding-profile/staging/.
