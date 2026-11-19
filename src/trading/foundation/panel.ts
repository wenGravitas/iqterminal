import type { IContentRenderer, IDockviewPanelProps } from 'dockview-core';
import './style.css';
import Decimal from 'decimal.js';
import { ACCOUNT_REGISTRY_KEY, groupAccounts, restoreRegistry, validateRegistry } from './accounts.ts';
import { accountScope, type AccountAllocation, type AccountRegistry, type BaseAsset, type ExecutionAccount, type TradePlan } from './domain.ts';
import { FoundationAccountClient, type AccountRead } from './client.ts';
import { previewAllocation } from './risk.ts';
import { executionIdentityDescription } from './confirmation.ts';
import { GroupSimulator, rehearsalAccounts, simulatedSnapshot, type SimEvent } from './simulator.ts';

const SIM_KEY = 'iq.trading.rehearsal.v1';
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function button(text: string, action: () => void, signal: AbortSignal) { const b = el('button', text); b.type = 'button'; b.addEventListener('click', action, { signal }); return b; }
function input(name: string, value = '', type = 'text') { const i = el('input'); i.type = type; i.value = value; i.setAttribute('aria-label', name); i.autocomplete = 'off'; i.spellcheck = false; return i; }
function select(name: string, options: [string, string][]) { const s = el('select'); s.setAttribute('aria-label', name); for (const [value, label] of options) s.add(new Option(label, value)); return s; }
function field(name: string, control: HTMLElement) { const l = el('label', '', 'tf-field'); l.append(el('span', name), control); return l; }

/** Native DOM account planning and explicitly selected deterministic rehearsal. */
export class TradingFoundationPanel implements IContentRenderer {
  readonly element = el('section', '', 'trading-foundation');
  private abort = new AbortController();
  private client = new FoundationAccountClient();
  private registry: AccountRegistry;
  private selection = select('Execution account or group', []);
  private status = el('p', 'Add an account to inspect its native venue, or explicitly load a practice group.', 'tf-status');
  private accountRows = el('div', '', 'tf-accounts');
  private accountDetails = el('details');
  private accountSummary = el('summary', 'Account identities and balances');
  private allocations = el('div', '', 'tf-allocations');
  private outcomes = el('div', '', 'tf-outcomes');
  private quoteReadout = el('p', 'Execution quote unavailable', 'tf-note');
  private groupMembers = el('div', '', 'tf-group-members');
  private base = select('Plan instrument', [['BTC', 'BTC / USDC perpetual'], ['ETH', 'ETH / USDC perpetual']]);
  private side = select('Plan side', [['buy', 'Buy / long'], ['sell', 'Sell / short']]);
  private entry = input('Plan entry price'); private stop = input('Plan stop price');
  private risk = input('Risk amount', '0.5');
  private riskMode = select('Risk mode', [['equity-percent', '% of current equity'], ['fixed-cash', 'Fixed USDC per account']]);
  private stopMode = select('Stop interpretation', [['absolute', 'Absolute stop level'], ['relative-distance', 'Same stop distance on each venue']]);
  private targets = input('Targets price:percent, comma separated'); private stopPercent = input('Stop allocation percent', '100');
  private slippage = input('Slippage provision basis points', '50'); private drift = input('Maximum venue price drift basis points', '50');
  private serviceToken = input('Testnet service token', '', 'password');
  private serviceConnected = false;
  private serviceSnapshots = new Map<string, AccountRead['snapshot']>();
  private serviceIntents: { accountId: string; status: string; message: string }[] = [];
  private data = new Map<string, AccountRead>();
  private errors = new Map<string, string>();
  private generation = 0; private dead = false; private busy = false;
  private draftId = `plan-${crypto.randomUUID()}`;
  private plan?: TradePlan; private preview: AccountAllocation[] = []; private simulation?: GroupSimulator;
  private rehearse: HTMLButtonElement; private submit: HTMLButtonElement;
  private confirm = el('dialog', '', 'tf-confirm');
  constructor(private options: { fixtureMode?: boolean; openLegacy?(): void } = {}) {
    let saved: string | null = null; try { saved = localStorage.getItem(ACCOUNT_REGISTRY_KEY); } catch { /* Session-only registry. */ }
    this.registry = restoreRegistry(saved);
    const signal = this.abort.signal;
    const header = el('header', '', 'tf-toolbar'); header.append(el('strong', 'Trading Accounts'), button('HL BTC ticket', () => this.options.openLegacy?.(), signal));
    this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    const body = el('div', '', 'tf-body');
    const scope = el('section', '', 'tf-section'); this.accountDetails.append(this.accountSummary, this.accountRows); scope.append(field('Execution destination', this.selection), this.accountDetails);
    const refresh = button('Refresh & preview', () => { void this.refresh(); }, signal);
    const practice = button('Load practice accounts', () => this.loadPractice(), signal); scope.append(refresh, practice);
    this.selection.addEventListener('change', () => { this.registry.selectedId = this.selection.value || null; this.persist(); this.invalidate(); this.render(); }, { signal });
    const add = el('details'); add.append(el('summary', 'Add named account')); add.append(this.accountForm()); scope.append(add);
    const group = el('details'); group.append(el('summary', 'Create account group'));
    const groupForm = el('form', '', 'tf-form'); const groupName = input('Group name');
    const saveGroup = el('button', 'Save group'); saveGroup.type = 'submit'; groupForm.append(field('Group name', groupName), this.groupMembers, saveGroup);
    groupForm.addEventListener('submit', event => {
      event.preventDefault(); this.run(() => {
        const ids = [...this.groupMembers.querySelectorAll<HTMLInputElement>('input:checked')].map(x => x.value);
        const id = `group-${crypto.randomUUID()}`;
        this.registry = validateRegistry({ ...this.registry, groups: [...this.registry.groups, { id, name: groupName.value, accountIds: ids }], selectedId: id });
        this.persist(); this.invalidate(); this.render(); group.open = false;
      });
    }, { signal }); group.append(groupForm); scope.append(group);
    const ticket = el('section', '', 'tf-section'); ticket.append(el('h3', 'Risk plan'), this.quoteReadout);
    const grid = el('div', '', 'tf-grid'); grid.append(field('Instrument', this.base), field('Direction', this.side), field('Entry', this.entry), field('Stop', this.stop),
      field('Risk basis', this.riskMode), field('Risk per account', this.risk), field('Stop interpretation', this.stopMode), field('Stop coverage %', this.stopPercent),
      field('Slippage provision · bp', this.slippage), field('Maximum venue drift · bp', this.drift), field('Targets · price:percent', this.targets));
    ticket.append(grid, button('Use execution quote', () => this.useQuote(), signal), this.allocations,
      el('p', 'Stops describe intended risk; gaps and liquidity can produce larger losses. TP and SL coverage are separate.', 'tf-note'));
    this.rehearse = button('Rehearse group plan', () => this.startSimulation(), signal); ticket.append(this.rehearse);
    for (const control of [this.base, this.side, this.entry, this.stop, this.riskMode, this.risk, this.stopMode, this.stopPercent, this.slippage, this.drift, this.targets]) control.addEventListener('change', () => {
      this.editDraft();
      if (control === this.base) this.data.clear();
      this.calculate(); this.renderAllocations(); this.renderOutcomes();
    }, { signal });
    const sim = el('section', '', 'tf-section'); sim.append(el('h3', 'Group rehearsal'), el('p', 'Simulated execution only. Account balances, fills and delays are synthetic.', 'tf-note'));
    const scenario = select('Rehearsal event', [['fill', 'Partial fill → acknowledge protection'], ['reject', 'Reject one follower'], ['timeout', 'Lose one acknowledgment'], ['manual-close', 'Observe manual follower close'], ['emergency', 'Emergency stop → reconcile flat']]);
    sim.append(scenario, button('Apply event', () => this.scenario(scenario.value), signal), this.outcomes);
    const service = el('details', '', 'tf-service'); service.append(el('summary', 'Testnet signing service'));
    service.append(el('p', 'Connect your locally started service at 127.0.0.1:8789. It holds dedicated testnet keys. Lighter API keys also permit owner withdrawals/transfers; this service only allows scoped trading commands. Session token is never saved.', 'tf-note'), field('Service token · session only', this.serviceToken), button('Connect testnet service', () => { void this.connectService(); }, signal), button('Disconnect service', () => { this.serviceToken.value = ''; this.serviceConnected = false; this.serviceSnapshots.clear(); this.serviceIntents = []; this.preview = []; this.renderAllocations(); this.status.textContent = 'Signing service disconnected from this panel. Venue orders remain authoritative.'; }, signal));
    this.submit = button('Review testnet limit entry', () => this.reviewTestnet(), signal); service.append(this.submit,
      el('p', 'Single-account native limit entry only. This does not arm a copier or an automatic exit manager. Reconcile positions and place protection through your venue before leaving a filled position.', 'tf-note'));
    body.append(scope, ticket, sim, service); this.element.append(header, this.status, body, this.confirm);
    try {
      const saved = localStorage.getItem(SIM_KEY);
      if (saved && saved.length < 300_000) { const value = JSON.parse(saved); const selected = groupAccounts(this.registry); if (selected.length && selected.every(a => a.mode === 'simulated') && value.state.children.every((c: any) => selected.some(a => a.id === c.accountId))) {
        this.plan = value.plan; this.simulation = new GroupSimulator(value.plan, [], selected, value.state); this.draftId = value.plan.id;
        this.base.value = value.plan.base; this.side.value = value.plan.side; this.entry.value = value.plan.entry; this.stop.value = value.plan.stop;
        this.riskMode.value = value.plan.risk.mode; this.risk.value = value.plan.risk.value; this.stopMode.value = value.plan.stopMode;
        this.stopPercent.value = value.plan.stopPercent; this.slippage.value = value.plan.slippageBps; this.drift.value = value.plan.maxDriftBps;
        this.targets.value = value.plan.targets.map((t: { price: string; percent: string }) => `${t.price}:${t.percent}`).join(',');
      } }
    } catch { /* Invalid rehearsal state never restores a signer or real command. */ }
    this.render();
  }
  init(_params: IDockviewPanelProps) {}
  private run(action: () => void) { try { action(); } catch (e) { this.status.textContent = e instanceof Error ? e.message : 'Account action failed'; } }
  private persist() { try { localStorage.setItem(ACCOUNT_REGISTRY_KEY, JSON.stringify(this.registry)); } catch { this.status.textContent = 'Storage unavailable; account names last for this session only'; } }
  private editDraft() { this.simulation = undefined; this.draftId = `plan-${crypto.randomUUID()}`; try { localStorage.removeItem(SIM_KEY); } catch { /* Session-only rehearsal is also invalidated. */ } }
  private invalidate() { this.generation++; this.preview = []; this.data.clear(); this.errors.clear(); this.editDraft(); this.status.textContent = 'Destination changed. Refresh account and execution quote to review allocations.'; }
  private accountForm() {
    const f = el('form', '', 'tf-form'), name = input('Account name'), venue = select('Account venue', [['hyperliquid', 'Hyperliquid'], ['lighter', 'Lighter']]),
      network = select('Account environment', [['testnet', 'Testnet · read-only'], ['mainnet', 'Mainnet · read-only']]), principal = input('Principal or L1 owner'), execution = input('Hyperliquid execution subaccount'), index = input('Lighter account index'), key = input('Lighter API-key index', '2');
    const hl = field('HL subaccount address · optional', execution), li = el('div', '', 'tf-grid'); li.append(field('Lighter account index', index), field('Dedicated API-key index', key)); li.hidden = true;
    venue.addEventListener('change', () => { hl.hidden = venue.value !== 'hyperliquid'; li.hidden = venue.value !== 'lighter'; }, { signal: this.abort.signal });
    const save = el('button', 'Save read-only account'); save.type = 'submit';
    f.append(field('Name', name), field('Venue', venue), field('Environment', network), field('Principal / L1 owner', principal), hl, li, save);
    f.addEventListener('submit', event => { event.preventDefault(); this.run(() => {
      const a: ExecutionAccount = { id: `account-${crypto.randomUUID()}`, name: name.value, environment: network.value as 'testnet' | 'mainnet', mode: 'read-only',
        identity: venue.value === 'hyperliquid' ? { venue: 'hyperliquid', principal: principal.value.trim(), executionAddress: execution.value.trim() || null }
          : { venue: 'lighter', owner: principal.value.trim(), accountIndex: Number(index.value), apiKeyIndex: Number(key.value) },
        policy: { maxRiskCash: '100', maxGrossNotional: '100000', maxLeverage: '1' } };
      this.registry = validateRegistry({ ...this.registry, accounts: [...this.registry.accounts, a], selectedId: a.id }); this.persist(); this.invalidate(); this.render();
      (f.parentElement as HTMLDetailsElement).open = false;
    }); }, { signal: this.abort.signal }); return f;
  }
  private loadPractice() {
    this.run(() => {
      const accounts = rehearsalAccounts(), ids = accounts.map(a => a.id), id = 'practice-group';
      this.registry = validateRegistry({ ...this.registry, accounts: [...this.registry.accounts.filter(a => !ids.includes(a.id)), ...accounts],
        groups: [...this.registry.groups.filter(g => g.id !== id), { id, name: 'Practice · HL + Lighter', accountIds: ids }], selectedId: id });
      this.entry.value = '100000'; this.stop.value = '99000'; this.targets.value = '102000:50,103000:50'; this.slippage.value = '0';
      this.persist(); this.invalidate(); this.render(); void this.refresh();
    });
  }
  private practiceRead(account: ExecutionAccount, now: number): AccountRead {
    const base = this.base.value as BaseAsset, price = base === 'BTC' ? '100000' : '4000';
    return { snapshot: simulatedSnapshot(account, now), spec: { venue: account.identity.venue, environment: account.environment, base, quote: 'USDC', payoff: 'linear', marketId: base === 'BTC' ? 1 : 0,
      sizeDecimals: base === 'BTC' ? 5 : 4, priceDecimals: base === 'BTC' ? 1 : 2, significantFigures: null, minSize: base === 'BTC' ? '0.00001' : '0.0001', minNotional: '10',
      maxLeverage: '5', makerFeeBps: '0', takerFeeBps: '0', capabilities: { limit: true, protectedIoc: true, postOnly: true, modify: true, reduceOnly: true, conditionalExits: true, nativeTwap: false, signing: 'none' } },
      quote: { venue: account.identity.venue, environment: account.environment, base, bid: price, ask: price, mark: price, triggerSource: 'Simulated mark', asOf: now } };
  }
  private async refresh() {
    if (this.busy) return;
    const accounts = groupAccounts(this.registry), generation = ++this.generation; this.busy = true; this.status.textContent = 'Reading selected execution accounts and native markets…'; this.renderAllocations();
    await Promise.all(accounts.map(async a => { try {
      if (this.options.fixtureMode && a.mode !== 'simulated') throw Error('Real venue reads and signing are disabled in diagnostic fixture mode');
      const read = a.mode === 'simulated' ? this.practiceRead(a, Date.now()) : await this.client.read(a, this.base.value as BaseAsset);
      if (this.dead || generation !== this.generation) return;
      if (this.serviceSnapshots.has(a.id)) read.snapshot = this.serviceSnapshots.get(a.id)!;
      this.data.set(a.id, read); this.errors.delete(a.id);
    } catch (error) { if (!this.dead && generation === this.generation) { this.data.delete(a.id); this.errors.set(a.id, error instanceof Error ? error.message : 'Account unavailable'); } } }));
    this.busy = false; if (this.dead || generation !== this.generation) return;
    this.calculate(); this.render(); this.status.textContent = this.errors.size ? 'Some accounts are unavailable. Each failed account remains blocked.' : `Updated ${accounts.length} ${accounts.every(a => a.mode === 'simulated') ? 'simulated' : 'read-only'} accounts. Review each allocation.`;
  }
  private buildPlan(): TradePlan {
    return { id: this.draftId, version: 1, base: this.base.value as BaseAsset, side: this.side.value as 'buy' | 'sell', entry: this.entry.value, stop: this.stop.value,
      risk: { mode: this.riskMode.value as 'equity-percent' | 'fixed-cash', value: this.risk.value }, stopMode: this.stopMode.value as 'absolute' | 'relative-distance',
      targets: this.targets.value.trim() ? this.targets.value.split(',').map(text => { const [price, percent] = text.trim().split(':'); return { price, percent }; }) : [], stopPercent: this.stopPercent.value,
      slippageBps: this.slippage.value, maxDriftBps: this.drift.value, maxDelayMs: 30_000, createdAt: Date.now() };
  }
  private calculate() {
    this.plan = this.buildPlan(); this.preview = [];
    for (const a of groupAccounts(this.registry)) {
      const read = a.mode === 'simulated' ? this.practiceRead(a, Date.now()) : this.data.get(a.id);
      if (read) { this.data.set(a.id, read); this.preview.push(previewAllocation(a, read.snapshot, read.spec, read.quote, this.plan)); }
    }
  }
  private useQuote() { const first = groupAccounts(this.registry)[0], q = first && this.data.get(first.id)?.quote; if (q) { this.entry.value = this.side.value === 'buy' ? q.ask : q.bid; this.editDraft(); this.calculate(); this.renderAllocations(); this.renderOutcomes(); } else this.status.textContent = 'Refresh the selected execution market first'; }
  private render() {
    this.selection.replaceChildren(new Option('Select account or group', ''));
    for (const a of this.registry.accounts) this.selection.add(new Option(`${a.name} · ${a.identity.venue} · ${a.mode === 'simulated' ? 'SIMULATED' : a.environment.toUpperCase()}`, a.id));
    for (const g of this.registry.groups) this.selection.add(new Option(`${g.name} · ${g.accountIds.length} accounts`, g.id));
    this.selection.value = this.registry.selectedId ?? '';
    this.groupMembers.replaceChildren();
    for (const a of this.registry.accounts) { const check = input(a.name, a.id, 'checkbox'); this.groupMembers.append(field(a.name, check)); }
    this.accountRows.replaceChildren();
    const selected = groupAccounts(this.registry);
    this.accountDetails.hidden = !selected.length;
    this.accountSummary.textContent = selected.map(a => `${a.name}: ${this.data.get(a.id)?.snapshot.equity ?? '—'} USDC`).join(' · ') || 'Account identities and balances';
    for (const a of groupAccounts(this.registry)) {
      const snapshot = this.data.get(a.id)?.snapshot;
      const line = el('div', '', 'tf-account-row'); line.append(el('strong', a.name), el('span', `${a.identity.venue} · ${a.environment.toUpperCase()} · ${a.mode === 'simulated' ? 'SIMULATED' : 'READ ONLY'}`),
        el('small', accountScope(a)), el('span', snapshot ? `Equity ${snapshot.equity} USDC · margin ${snapshot.availableMargin} · age ${Math.max(0, Math.round((Date.now() - snapshot.asOf) / 1000))}s · ${snapshot.marginMode}` : this.errors.get(a.id) ?? 'Not connected'));
      if (snapshot) line.append(el('small', `${snapshot.tier} · imposed delay ${snapshot.imposedDelayMs === null ? 'unverified' : `${snapshot.imposedDelayMs}ms`}`));
      this.accountRows.append(line);
    }
    this.renderAllocations(); this.renderOutcomes();
  }
  private renderAllocations() {
    this.allocations.replaceChildren(); const accounts = groupAccounts(this.registry);
    const quotes = accounts.map(a => this.data.get(a.id)?.quote).filter(q => q !== undefined);
    this.quoteReadout.textContent = quotes.length ? quotes.map(q => `${q.venue} ${q.base} · bid ${q.bid} / ask ${q.ask} · ${q.triggerSource} ${q.mark}`).join(' | ') : 'Execution quote unavailable';
    for (const a of accounts) {
      const p = this.preview.find(p => p.accountId === a.id), line = el('div', '', 'tf-allocation'); line.dataset.accountId = a.id;
      line.append(el('strong', a.name));
      if (!p || p.status === 'blocked') line.append(el('span', `Blocked · ${p?.reasons.join('; ') ?? this.errors.get(a.id) ?? 'Refresh this account and quote'}`));
      else { line.append(el('span', `${p.size} ${p.base} · requested risk ${p.requestedRisk} / executable ${p.executableRisk} USDC`), el('small', `Margin ${p.margin} · fees estimate ${p.estimatedFees} · planned stop ${p.stopCoveragePercent}%`)); for (const reason of p.reasons) line.append(el('small', reason)); }
      this.allocations.append(line);
    }
    this.rehearse.disabled = this.busy || !accounts.length || accounts.some(a => a.mode !== 'simulated') || !this.preview.some(a => a.status === 'ready');
    this.submit.disabled = Boolean(this.options.fixtureMode) || this.busy || !this.serviceConnected || accounts.length !== 1 || accounts[0]?.environment !== 'testnet' || accounts[0]?.mode !== 'read-only' || this.preview[0]?.status !== 'ready';
  }
  private startSimulation() { this.run(() => { this.calculate(); if (!this.plan) return; this.simulation = new GroupSimulator(this.plan, this.preview, groupAccounts(this.registry)); this.saveSimulation(); this.renderOutcomes(); }); }
  private saveSimulation() { if (this.simulation) try { localStorage.setItem(SIM_KEY, JSON.stringify({ plan: this.plan, state: this.simulation.state })); } catch { this.status.textContent = 'Rehearsal state could not be saved'; } }
  private scenario(kind: string) {
    this.run(() => {
      const sim = this.simulation; if (!sim) throw Error('Rehearse a valid simulated plan first');
      if (kind === 'emergency') {
        sim.emergencyStop(); this.saveSimulation();
        for (const c of sim.state.children.filter(c => c.phase !== 'rejected')) {
          sim.apply({ id: `exit:${c.id}:${c.lastSequence + 1}`, childId: c.id, sequence: c.lastSequence + 1, kind: 'exit', quantity: c.remaining });
          sim.apply({ id: `flat:${c.id}:${c.lastSequence + 2}`, childId: c.id, sequence: c.lastSequence + 2, kind: 'reconcile-flat' });
        }
      } else if (kind === 'fill') {
        for (const c of sim.state.children.filter(c => !c.detached && c.phase !== 'rejected')) {
          const filled = Decimal.max(c.filled, new Decimal(c.quantity).div(2)).toFixed();
          sim.apply({ id: `fill:${c.id}:${c.lastSequence + 1}`, childId: c.id, sequence: c.lastSequence + 1, kind: 'fill', quantity: filled });
          const current = sim.state.children.find(x => x.id === c.id)!;
          sim.apply({ id: `protect:${c.id}:${c.lastSequence + 2}`, childId: c.id, sequence: c.lastSequence + 2, kind: 'protection', quantity: new Decimal(current.remaining).mul(c.stopCoveragePercent).div(100).toFixed() });
        }
      } else {
        const c = sim.state.children.find(c => !c.detached && c.phase !== 'rejected'); if (!c) throw Error('No eligible simulated child');
        sim.apply({ id: `${kind}:${c.id}:${c.lastSequence + 1}`, childId: c.id, sequence: c.lastSequence + 1, kind: kind as SimEvent['kind'] });
      }
      this.saveSimulation(); this.renderOutcomes();
    });
  }
  private renderOutcomes() {
    this.outcomes.replaceChildren();
    if (!this.simulation) { this.outcomes.append(el('p', 'No simulated plan submitted.', 'tf-note')); return; }
    const summary = this.simulation.summary();
    this.outcomes.append(el('p', `SIMULATED · ${summary.protected} protected · ${summary.rejected} rejected · ${summary.unknown} unknown · ${summary.confirmedFlat} confirmed flat${this.simulation.state.emergencyStopped ? ' · emergency stop persisted' : ''}`));
    for (const c of this.simulation.state.children) { const line = el('div', '', 'tf-allocation'); line.append(el('strong', `${this.registry.accounts.find(a => a.id === c.accountId)?.name ?? c.accountId} · ${c.phase}`), el('span', `${c.remaining} open / ${c.stopAcknowledged} stop acknowledged`), el('small', c.reason)); this.outcomes.append(line); }
  }
  private async serviceRequest(path: string, body?: unknown) {
    if (this.options.fixtureMode) throw Error('Testnet service disabled in diagnostic fixture mode');
    const response = await fetch(`http://127.0.0.1:8789${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${this.serviceToken.value}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(45_000)]) });
    const data = await response.json(); if (!response.ok) throw Error(data.error ?? 'Testnet service rejected the command'); return data;
  }
  private async connectService() {
    try {
      const result = await this.serviceRequest('/v1/accounts'); if (this.dead) return;
      if (result.environment !== 'testnet') throw Error('Unexpected service environment');
      const accounts: ExecutionAccount[] = result.accounts.map((a: any) => a.account);
      this.registry = validateRegistry({ ...this.registry, accounts: [...this.registry.accounts.filter(a => !accounts.some(b => b.id === a.id || accountScope(a) === accountScope(b))), ...accounts], selectedId: accounts[0]?.id ?? this.registry.selectedId });
      this.serviceSnapshots.clear(); for (const a of result.accounts) this.serviceSnapshots.set(a.account.id, a.snapshot);
      this.serviceIntents = result.intents; this.serviceConnected = true; this.persist(); this.invalidate(); this.render(); await this.refresh();
      this.status.textContent = 'Authorized local testnet service connected. Review the exact account before signing.';
    } catch (e) { this.serviceConnected = false; this.status.textContent = e instanceof Error ? e.message : 'Testnet service unavailable'; this.renderAllocations(); }
  }
  private reviewTestnet() {
    if (this.submit.disabled || !this.plan) return;
    const account = groupAccounts(this.registry)[0], plan = structuredClone(this.plan), allocation = this.preview[0];
    const heading = el('h3', `TESTNET · ${account.name} · ${account.identity.venue}`), identity = el('p', executionIdentityDescription(account));
    heading.id = `tf-confirm-${crypto.randomUUID()}`; identity.id = `${heading.id}-identity`;
    const description = el('p', `${plan.side.toUpperCase()} ${allocation.size} ${plan.base} limit @ ${allocation.entry}. This sends a native entry only; no automatic protection manager is armed.`); description.id = `${heading.id}-description`;
    this.confirm.setAttribute('aria-labelledby', heading.id); this.confirm.setAttribute('aria-describedby', `${identity.id} ${description.id}`);
    this.confirm.replaceChildren(heading, identity, description);
    const guard = input('Type TESTNET to confirm'), accept = button('Send testnet limit', () => { if (guard.value !== 'TESTNET') return; this.confirm.close(); void this.sendTestnet(account, plan); }, this.abort.signal);
    this.confirm.append(field('Type TESTNET', guard), button('Cancel', () => this.confirm.close(), this.abort.signal), accept); this.confirm.showModal(); guard.focus();
  }
  private async sendTestnet(account: ExecutionAccount, plan: TradePlan) {
    this.busy = true; this.renderAllocations();
    try {
      const result = await this.serviceRequest('/v1/commands', { operation: 'place', accountId: account.id, idempotencyKey: `entry-${crypto.randomUUID()}`, confirmation: 'TESTNET', plan });
      this.serviceIntents.push(result); this.status.textContent = `${account.name} · ${result.status}: ${result.message}`;
    } catch { this.status.textContent = 'Testnet command outcome uncertain. Inspect service ledger and authoritative venue orders; do not retry.'; }
    this.busy = false; this.preview = []; this.renderAllocations();
  }
  dispose() { this.dead = true; this.generation++; this.abort.abort(); this.client.dispose(); this.serviceToken.value = ''; this.serviceSnapshots.clear(); this.confirm.close(); this.confirm.remove(); }
}
