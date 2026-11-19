# Trading Foundation R1

This feature is based on frontend `3e73e60bc0f3f3e197f0990f21680cb3b232d7d5` in the isolated `feature/trading-foundation-r1` worktree. The supplied [implementation plan](IQ_Terminal_Trading_Implementation_Plan.docx) describes a multi-stage trading programme. This foundation adds named personal accounts, shared execution contracts, independently calculated risk previews, genuine venue adapters, a restricted local testnet signing path, and deterministic group rehearsal. It does **not** establish production trading readiness or certify a live copier.

The existing Hyperliquid BTC ticket and encrypted browser vault remain available. The new **Accounts** footer action / **Trading Accounts** widget opens the account planner. Its registry is global across chart workspaces. Switching chart tabs does not change the selected execution identity. Reopening the planner restores public account names, groups and the last saved simulated lifecycle. Signing service tokens are session-only and reload locked.

## Account and instrument contract

- Hyperliquid identity separates the principal that authorizes an agent from the execution address. A master uses no execution override. A subaccount is queried directly, must be returned by the principal's authoritative `subAccounts` response, and is supplied as SDK `defaultVaultAddress` for all mutations. A read alone never proves subaccount execution routing.
- Lighter identity binds environment, L1 owner, account index and dedicated API-key index 2–254. Account index is verified against the public account's L1 owner. Credential nonce coordination belongs to that native account/key, independently of workspace labels.
- Duplicate names cannot create separate balances: the registry rejects duplicate execution scopes, nested groups, duplicate members, mixed environments and real/simulated groups. Persisted records contain an explicit public-field allowlist.
- Market mapping requires a single active native BTC or ETH USDC linear perpetual, authoritative precision and minimums. The Lighter adapter preserves native market index, product kind, order type and TIF. A same-symbol spot order cannot be modified or canceled as a perpetual. Other products and native TWAP remain outside this certification.
- The public-read worker owns account/market requests and bounded adapter references. Reads fail visibly; there is no fixture connectivity fallback. Lighter public monitoring cannot claim complete orders when authenticated working orders are unavailable.

## Risk preview and rehearsal

Each account uses its own current equity or fixed USDC risk, execution quote, instrument precision, stop distance, estimated round-trip fees, slippage provision, available margin and account limits. Quantity rounds down. Unknown configured leverage uses a conservative 1x margin estimate; the signed Hyperliquid adapter reads actual BTC/ETH leverage. Gross exposure includes the complete venue account view. Unknown external exposure blocks new plan risk rather than treating a chart-filtered position list as account-wide risk.

Absolute stop levels and equal relative stop distance are explicit modes. Excessive destination price drift, stale account/quote data, expired plans, current exposure in the target instrument, unknown working orders, minimum size/notional, margin and risk-limit failures block the allocation. There is no silent risk auto-cap. TP allocations and SL coverage are independent alternatives: 100% of targets plus a 100% stop is valid. Partial stop coverage remains visible.

**Load practice accounts** is an explicit selection of four synthetic balances and two venue identities per venue. The simulator uses parent and distinct child IDs, exact cumulative fills, acknowledgment-dependent protection, duplicate/out-of-order sequence handling, rejected/unknown followers, external-close detachment, capped reduce-only exit races and a persisted emergency stop. The same allocation logic exercises HL→HL, Lighter→Lighter and both cross-venue directions. Simulated stop acknowledgment is not a venue-attached protective order, and rehearsal does not promise realistic liquidity, queue priority, fill timing or profitability.

The browser simulator is a deterministic command-owner harness, not a production scheduler or transactional customer OMS. The production programme still requires an authenticated managed service/database, account leases, provider-approved capacity, operations and a separate bounded live pilot. Propr purchase/rules, observed-leader copying, chart drawing-to-plan dispatch and managed chase/TWAP/iceberg are later packages in the supplied plan.

## Restricted testnet signing service

Lighter's official signer uses native libraries. It is not substituted with viem or an unverified browser signing implementation. The local service holds dedicated testnet credentials outside the browser and uses the official Python SDK/native signer pinned at [`71dc79cd3cd499825f88b01adede2fe8aa183955`](https://github.com/elliottech/lighter-python/tree/71dc79cd3cd499825f88b01adede2fe8aa183955). The installed SDK identifies itself as 1.1.9. Endpoint `https://api.testnet.lighter.xyz` and chain ID **300** are explicit and inseparable. The install receipt proves Linux aarch64 native loading only; it is not an authenticated order test.

Create a dedicated virtual environment and install the pinned dependency set:

```sh
python3 -m venv ~/.local/share/iq-trading-lighter-venv
~/.local/share/iq-trading-lighter-venv/bin/pip install -r scripts/trading/lighter-requirements.lock.txt
~/.local/share/iq-trading-lighter-venv/bin/python scripts/trading/lighter-signing-worker.py --check-install
```

The lock was resolved on Linux aarch64/Python 3.11. Recheck platform availability when changing host. No native signer binary is bundled into the web application. Upstream dependencies retain their own licenses.

Create a private configuration file **outside the repository** with the public account records and names of credential environment variables. Example structure (replace all sample identities with actual funded testnet identities):

```json
{
  "accounts": [{
    "id": "hl-day-testnet", "name": "Hyperliquid Day Trading", "environment": "testnet", "mode": "read-only",
    "identity": {"venue": "hyperliquid", "principal": "0x1111111111111111111111111111111111111111", "executionAddress": null},
    "policy": {"maxRiskCash": "1", "maxGrossNotional": "50", "maxLeverage": "1"}
  }],
  "credentialEnvs": {"hl-day-testnet": "IQ_HL_DEDICATED_TESTNET_AGENT"}
}
```

For Lighter, use `{"venue":"lighter","owner":"0x...","accountIndex":123,"apiKeyIndex":2}` and a dedicated testnet API credential environment variable. An API key is broader than a Hyperliquid agent: it can authorize owner withdrawals and same-owner transfers. The service exposes none of those actions. It never receives a master wallet seed or L1 private key.

Set these variables in the shell that starts the service, using a secret manager or silent shell input for credentials and the random bearer token. Do not paste secrets into command arguments or commit them:

```sh
export IQ_TRADING_TESTNET_CONFIG="$HOME/.config/iq-terminal/testnet-accounts.json"
export IQ_TRADING_TESTNET_LEDGER="$HOME/.local/share/iq-terminal/testnet-intents.json"
export IQ_LIGHTER_PYTHON="$HOME/.local/share/iq-trading-lighter-venv/bin/python"
export IQ_TRADING_TESTNET_ORIGIN='http://127.0.0.1:4173'
# Set IQ_TRADING_TESTNET_TOKEN (random, at least 32 characters) and the configured dedicated testnet credential variables privately.
pnpm trading:testnet:service
```

Start the browser preview on the exact configured origin. Open **Accounts → Testnet signing service**, enter the bearer token, and connect. The service imports only its allowlisted public identities. The UI's signed action is a reviewed **single-account native limit entry**. It does not attach the draft stop or targets, start a managed copier, or imply venue protection. Keep a filled position under direct supervision and use the venue interface for protection and emergency actions.

Only Lighter Standard accounts with verified tier can increase exposure in this foundation path. Other account tiers await fee-specific certification. The account read reports the tier and Standard's documented 300ms taker/cancel/modify delay separately from local processing. No tier change, quota purchase, integrator surcharge, transfer or withdrawal route exists.

The service binds only `127.0.0.1:8789`; exact Host, exact allowed loopback Origin and timing-safe bearer authentication are required. There is no production endpoint switch. Its HTTP API is:

| Route | Behavior |
| --- | --- |
| `GET /v1/accounts` | Authenticated account snapshots and public intent outcomes; no credentials or native auth tokens. |
| `POST /v1/commands` | `operation: place / modify / cancel`, allowlisted `accountId`, unique `idempotencyKey`, `confirmation: TESTNET`, and the shared plan for placement/modification. |
| `POST /v1/reconcile` | `accountId` and `intentId`; queries terminal native order status first and then a fresh complete account snapshot. |

Placement supports native limit/post-only entries. Adapter contracts also implement protected IOC reduction, conditional reduce-only exits, native modification and known-order cancellation for the external acceptance harness. Lighter modification preserves native client ID and rejects changes to order kind, TIF, account, product or direction. Cancellation resolves a known authoritative order in the correct account and native instrument without requiring a healthy chart/quote. A bounded emergency read allowance remains after ordinary reads exhaust their budget. If account/venue access is unavailable, use the official venue interface; the service cannot truthfully report cancellation or flat.

For every command, the server repeats account identity, metadata and risk validation from fresh venue inputs. It does not trust a browser preview or allocation. It serializes dispatch and persists the exact scope and unknown outcome **before** signing; file and parent-directory fsync complete before dispatch. A private writer lock excludes a second local process. Clean shutdown removes the lock. After a crash, inspect its recorded PID and ensure the old process has stopped before manually removing the stale `.lock`; restarting never automatically clears a writer fence or an unknown reservation.

Idempotency includes all mutation-affecting fields. An identical key returns the durable result; a changed command is rejected. Renaming/recreating an account cannot evade an unresolved native execution-scope reservation. The same account ID cannot be repointed to a different scope. Modification retains one controlling reservation at max(original, replacement) until reconciliation; it cannot silently exceed the original authorized risk budget. A transport timeout remains **unknown**, and no automatic equivalent order retry occurs. Native terminal status plus a fresh flat/no-working-orders snapshot is required to release the reservation. An absent status or bounded history miss is not a rejection.

This is a local single-owner testnet acceptance tool, not cross-device execution coordination, durable production custody, an always-on protection manager, or evidence of mainnet CSP/security readiness.

## Verification and external acceptance

Current local results and independent review limits are recorded in the [verification receipt](../artifacts/trading-foundation/verification.md).

Run the local gates:

```sh
pnpm test:trading:foundation
pnpm exec vitest run tests/trading-model.test.ts tests/trading-controller.test.ts tests/trading-worker.test.ts tests/trading-adapter.test.ts tests/trading-vault.test.ts tests/trading-owner.test.ts tests/widget-registry.test.ts tests/layout.test.ts tests/workspaces.test.ts --maxWorkers=1 --testTimeout=15000
pnpm typecheck
VITE_DIAGNOSTICS=1 pnpm build
pnpm exec playwright test --config scripts/trading/browser.config.ts
pnpm trading:probe --output artifacts/trading-foundation/public-venue-probe.json
```

| R1 requirement | Implementation / evidence | Acceptance boundary |
| --- | --- | --- |
| Named HL/Lighter accounts, groups, explicit identity | Registry allowlist and negative duplicate/mixed/cyclic group tests; browser account workflow | Public state only; importing a name never authorizes signing. |
| Account/instrument/capability contracts | Shared domain; BTC/ETH native metadata and exact integer/decimal tests | Other products and native TWAP disabled. |
| Real adapters and supported testnet signing | HL official SDK; pinned Lighter native signer/bridge; account/subaccount/key/index/market routing tests | Authenticated funded order lifecycles remain external. |
| Independent risk/allocation previews | Per-account equity, costs, round-down, drift/expiry, margin/exposure/risk reservation tests | Intended loss estimate; not a guarantee of realized loss. |
| Group lifecycle and failure rehearsal | All four venue directions; partial fill, stop ACK, rejection, lost ACK, duplicates, detach, racing exits and emergency restart fixtures | Deterministic simulation, not real cross-venue execution. |
| UI workflow | Dockview/widget/footer integration, saved layout v11, desktop/narrow browser checks, fixture signing guard | No live group arming or automatic protection. |
| Real venue evidence | [Public REST probe](../artifacts/trading-foundation/public-venue-probe.json), [native signer install](../artifacts/trading-foundation/native-signer-install.json) | Public quote/metadata and library loading prove neither funded accounts nor signed acceptance. |
| Safety review | Narrow independent authentication/signing/persistence review and targeted regressions | Review findings must be resolved before commit. |

External acceptance requires separately funded testnet principal/subaccounts and API authorization for Hyperliquid; current Lighter testnet owner/account/API-key identities, funded collateral and active BTC/ETH markets; reachable supported endpoints; explicit small testnet exposure caps; and venue UI access for recovery. No such credentials or order authorization were inferred from public account existence or the historical Hyperliquid guide.

For **each** certified account and BTC/ETH market, record: environment and endpoint; actual execution identity; tier/fees/delays; metadata and min-size rounding; place/ACK/native order identity; modification with unchanged intended kind; cancel and terminal reconciliation; tiny IOC entry and reduce-only partial/full close; stop/target acceptance and separately observed trigger/partial-fill/race behavior; key revocation/rotation; lost acknowledgment/restart recovery. Then certify same-venue and both cross-venue workflows in compatible environments. Testnet prices/liquidity/reset state may differ materially; production copying requires its own separately bounded pilot and managed execution service.

The supplied plan's full public-release acceptance list is not marked complete by these local tests. No mainnet order was submitted, no production pilot was run, and no merge or deployment is part of this feature branch.
