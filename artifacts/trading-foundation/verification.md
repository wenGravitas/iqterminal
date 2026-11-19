# Trading Foundation R1 verification

Verified on 19 November 2026, Linux aarch64, Node 22.19.0. Release base: `3e73e60bc0f3f3e197f0990f21680cb3b232d7d5`. Worktree: `iqterminal-trading-r1`, branch `feature/trading-foundation-r1`. The unrelated dirty main checkout was preserved.

| Gate | Result |
| --- | --- |
| Foundation unit/adapter tests | **53 passed** across `trading-foundation.test.ts` and `trading-foundation-adapters.test.ts`. |
| Restricted service regressions | **15 passed**, including rename/restart lost ACK, native client-ID preservation, max(original,replacement) reservation, terminal-then-fresh-snapshot race, strict malformed ledger rejection and file/directory fsync. |
| Python bridge conformance | **3 passed** without credentials/network/signing. Tests endpoint+chain300, integer arguments, expired commands and foreign account/key/withdraw rejection. |
| Existing trading/widget/layout/workspace regression | **105 passed** across nine test files with `--maxWorkers=1 --testTimeout=15000`. Two existing scrypt vault cases initially exceeded their default 5s while build/browser ran concurrently; isolated vault rerun passed8/8 and the bounded full targeted rerun passed105/105. Vault implementation was unchanged. |
| Typecheck | Passed. |
| Production build | Passed; incumbent large-chunk advisory remains. |
| Diagnostic build + focused browser | **4 passed**; [browser receipt](browser-results.json). Covers named allocations/rehearsal/partial protection/emergency persistence, stale-draft invalidation through edits and quote button, fixture signing guard, exact identity/accessible confirmation/focus/Escape with **zero mutation requests**, and 720px/desktop layout. Service/venue responses in the confirmation case are explicit mocks. |
| Native signer installation | [Official pinned SDK loads on Linux aarch64](native-signer-install.json). No credential or signing call. |
| Read-only public venue checks | [Public REST probe](public-venue-probe.json), described below. |
| Staged whitespace / artifact checks | `git diff --check` passed. No runtime ledger, bearer token, private key, virtualenv or Python bytecode staged. |

The public probe passed Hyperliquid BTC and ETH metadata/quotes on mainnet and testnet and Lighter BTC on mainnet. Lighter testnet BTC/ETH and mainnet ETH requests failed intermittently during this network run and remain marked unavailable in the receipt. These are public reads without a customer account, funded balance, agent/API-key authorization or order acceptance. No unavailable venue used simulated data as fallback. Native market IDs are read from each environment rather than inferred from another network.

The native library receipt proves installation/platform compatibility. The Python conformance tests use a fake signer and prove argument/scope behavior. Neither is signed venue acceptance. No new real testnet order, mainnet signed action, live copier or production pilot was executed in this change.

## Independent review

A narrow GPT-6 Astra review examined authentication, account routing, signing, nonce/dispatch boundaries, durable intent/reservation recovery and secret handling after implementation investigation. It independently reran52 unit/adapter and15 service tests and reported no remaining material findings for the **local single-owner testnet boundary**. The later53rd unit test covers public identity text in the UI confirmation.

Confirmed findings were corrected and regression-tested: pinned Lighter SDK field names and native product identity; arbitrary credential variable isolation in the child environment; account rename/repoint reservation bypass; replacement identity/budget retention; terminal/read ordering; parent-directory durability; malformed array ledgers; bounded deadline enforcement at adapter/bridge/native boundaries; and reserved emergency read capacity.

The fresh Sol Max UI review examined desktop/narrow captures and source. Its material fixes were exact execution identity in the review dialog, associated accessible name/description, and stale rehearsal invalidation through both input edits and the execution-quote button. The [desktop](desktop.png), [narrow](narrow.png), [confirmation desktop](confirmation-desktop.png) and [confirmation narrow](confirmation-narrow.png) captures retain the incumbent terminal theme and native controls.

## External acceptance still required

The [requirement audit and testnet checklist](../../docs/trading-foundation-r1.md) identify the remaining external prerequisites: funded and authorized HL master/subaccounts; current Lighter owner/account/key identities, funded collateral, Standard tier, reachable supported testnet and active BTC/ETH markets; explicit small exposure caps; and venue-interface recovery access. Signed place/modify/cancel/close/protection-trigger workflows must be recorded per account/market before live capability certification. Testnet environments must be checked for compatible prices/liquidity/reset state before cross-venue acceptance.

The foundation UI signs only reviewed single-account testnet limit entry through the optional local service. Draft stops/targets are **not attached by that button**. Simulated protection is not venue protection. Mainnet signing, managed copying, durable production OMS, Propr and managed algorithms remain outside this foundation's enabled workflow. No merge or deployment was performed.
