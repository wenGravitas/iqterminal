import { MAP_VENUES, mapSettings, type MapSettings, type MapSourceStatus } from './model';
export class MapControls {
    sources: MapSourceStatus[] = [];
    readonly dialog = document.createElement('dialog');
    private abort = new AbortController();
    constructor(host: HTMLElement, private change: (s: MapSettings) => void) { this.dialog.className = 'indicator-settings footprint-settings-dialog'; this.dialog.setAttribute('aria-label', 'Liquidation Map settings'); host.append(this.dialog); }
    open(value: unknown) {
        const s = mapSettings(value);
        this.dialog.replaceChildren();
        const form = document.createElement('form');
        form.method = 'dialog';
        form.className = 'indicator-settings-form';
        const fields = document.createElement('div');
        fields.className = 'indicator-settings-fields';
        const header = document.createElement('header');
        const title = document.createElement('h2');
        title.textContent = 'Liquidation Map';
        header.append(title);
        form.append(header, fields);
        const inputs = new Map<string, HTMLInputElement>();
        const field = (key: string, label: string, value: string | boolean) => { const row = document.createElement('label'); row.className = 'indicator-setting-field'; const caption = document.createElement('span'); caption.textContent = label; row.append(caption); const input = document.createElement('input'); input.name = key; if (typeof value === 'boolean') {
            input.type = 'checkbox';
            input.checked = value;
        }
        else {
            input.type = 'number';
            input.value = value;
            input.step = 'any';
        } row.append(input); fields.append(row); inputs.set(key, input); };
        for (const v of MAP_VENUES)
            field('venue:' + v, v, s.venues.includes(v));
        for (const l of [3, 5, 10, 25, 50, 100])
            field('leverage:' + l, `${l}x model scenario`, s.leverage.includes(l));
        for (const [key, label] of [['longs', 'Long exposure'], ['shorts', 'Short exposure'], ['observed', 'Observed positions'], ['estimated', 'Model estimates'], ['includeUnknownLeverage', 'Unclassified observed leverage'], ['profile', 'Right-side latest stock profile'], ['profileCrosshair', 'Profile follows crosshair'], ['labels', 'Cell labels']] as const)
            field(key, label, s[key]);
        for (const [key, label] of [['priceWidth', 'Price grouping (native quote)'], ['resolution', 'Time resolution (ms)'], ['lookback', 'Lookback (ms)'], ['minimum', 'Minimum exposure'], ['opacity', 'Opacity'], ['intensity', 'Intensity'], ['fixedMaximum', 'Fixed colour maximum (0 = automatic)']] as const)
            field(key, label, String(s[key]));
        const note = document.createElement('p');
        note.textContent = 'Conditional exposure. Observed coverage is a subset. Model scenarios are uncalibrated; cross margin and unknown collateral remain unresolved. Base display is BTC; cross-quote prices retain native venue basis.';
        note.style.fontSize = '10px';
        fields.append(note);
        const units = document.createElement('select');
        units.setAttribute('aria-label', 'Exposure units');
        for (const v of ['BTC', 'native-quote']) {
            const o = document.createElement('option');
            o.value = v;
            o.textContent = v === 'BTC' ? 'BTC base quantity' : 'Native quote at threshold (matching chart quote only)';
            units.append(o);
        }
        units.value = s.units;
        const unitsLabel = document.createElement('label');
        unitsLabel.className = 'indicator-setting-field';
        const unitsCaption = document.createElement('span'); unitsCaption.textContent = 'Exposure units';
        unitsLabel.append(unitsCaption, units); fields.append(unitsLabel);
        for (const [name, leverage, lookback] of [['Swing', [3, 5, 10], 24 * 3600000], ['Scalping', [25, 50, 100], 3600000]] as const) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = name;
            b.onclick = () => { for (const l of [3, 5, 10, 25, 50, 100])
                inputs.get('leverage:' + l)!.checked = (leverage as readonly number[]).includes(l); inputs.get('lookback')!.value = String(lookback); };
            fields.append(b);
        }
        const status = document.createElement('div');
        const statusCaption=document.createElement('p');statusCaption.textContent='Source inventory snapshot at '+new Date().toISOString()+' (all scenarios; unfiltered).';status.append(statusCaption);
        for (const sample of this.sources) {
            const source=sample.asOf&&Date.now()-sample.asOf>120000?{...sample,state:sample.state+' (stale snapshot)',freshQuantity:0,staleQuantity:sample.staleQuantity+sample.freshQuantity,locatedQuantity:0,coverageProxy:null,locatedCoverageProxy:null}:sample;
            const row = document.createElement('p');
            row.textContent = `${source.venue}: ${source.state} · ${source.asOf ? Math.max(0, Math.round((Date.now() - source.asOf) / 1000)) + 's old' : 'no sample'} · ${source.accounts} accounts · fresh ${source.freshQuantity.toPrecision(3)} BTC · located ${source.locatedQuantity.toPrecision(3)} BTC · stale ${source.staleQuantity.toPrecision(3)} BTC · unknown ${source.unknownQuantity.toPrecision(3)} BTC · coverage ${source.coverageProxy === null ? 'unverified' : (source.coverageProxy * 100).toPrecision(2) + '% captured-position proxy'} · threshold coverage ${source.locatedCoverageProxy == null ? 'unverified' : (source.locatedCoverageProxy * 100).toPrecision(2) + '% proxy'} · ${source.message}${source.unknownBreakdown?' · unlocated reasons '+Object.entries(source.unknownBreakdown).map(([reason,q])=>reason+' '+q.toPrecision(3)+' BTC').join(', '):''}${source.unresolvedCollateralQuantity!==undefined?' · actual account collateral unobserved for '+source.unresolvedCollateralQuantity.toPrecision(3)+' BTC (overlaps scenario quantities)':''}`;
            status.append(row);
        }
        fields.append(status);
        const footer = document.createElement('footer');
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.onclick = () => this.dialog.close();
        footer.append(cancel);
        const apply = document.createElement('button');
        apply.type = 'submit';
        apply.textContent = 'Apply';
        apply.className = 'primary';
        footer.append(apply);
        form.append(footer);
        form.onsubmit = e => { e.preventDefault(); const next: any = { ...s, units: units.value, venues: MAP_VENUES.filter(v => inputs.get('venue:' + v)!.checked), leverage: [3, 5, 10, 25, 50, 100].filter(l => inputs.get('leverage:' + l)!.checked) }; for (const [key, input] of inputs)
            if (!key.includes(':'))
                next[key] = input.type === 'checkbox' ? input.checked : Number(input.value); this.change(mapSettings(next)); this.dialog.close(); };
        this.dialog.append(form);
        this.dialog.showModal();
    }
    dispose() { this.abort.abort(); this.dialog.remove(); }
}
