# Order Book normal staging route

The normal staging endpoint now runs backend main `9b8cc2cafb349d6ecd29a0022e7246ec95ebc3aa`. Order Book requests use the same current lane as other live data:

`/market-data/v1/depth-matrix` → local SSH 18781 → staging gateway 18780 → the appropriate Binance collector.

The temporary review client and tunnel user services were stopped, their runtime drop-ins removed, the remote adapter process stopped, and `/tmp/iq-order-book-review.mjs` deleted. No 18940 listener remains locally or remotely. The main staging client was restarted with no Order Book environment override. The normal tunnel and prepared-wall lanes remain in use.

The Vite `VITE_DEPTH_MATRIX_API_URL` override was removed. The live browser config now uses the normal endpoint. Backend adapter source helpers were removed in the backend main checkout. Deployment image pins and rollback instructions live in that repository's `compose.staging-order-book.yaml` and `docs/ORDER-BOOK-STAGING-DEPLOYMENT.md`; changes are left uncommitted and unpushed for the user.

## Evidence

- Backend merged-source typecheck, 472 tests and production image build passed on staging. Three updated services are healthy; the other 34 running containers are unchanged.
- Both Spot and perpetual returned advancing, fresh committed books with cumulative version 1 matching their row cursor/epoch/time. This passed directly on staging and through port 5173 after adapter cleanup.
- Frontend: 41 focused routing, transport and Order Book tests passed; typecheck and production build passed with the existing large-bundle advisory.
- The normal-route live headless Pi browser test passed in 40.3s, checking Compact and Single with both books live and display-only changes issuing no additional subscription commands. Initial usable render was 17,136ms; the run observed 84 depth requests across 21 unique request grids. This is functional browser evidence, not a startup-latency or foreground/compositor performance pass.
- Vite logged WebSocket EPIPE errors during the browser run and teardown. The Order Book assertions passed, but this run does not establish uninterrupted stream reliability.

Raw receipts: `artifacts/order-book/staging-deployment/`, `artifacts/order-book/staging-browser-results.json`, and `artifacts/order-book/staging-headless-pi.json`. Earlier isolated-adapter artifacts remain historical evidence.

No production changes or Git pushes were made.
