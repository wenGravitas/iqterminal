var FontComparison = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region ../iqterminal/node_modules/.pnpm/openalgo-charts@2.6.0/node_modules/openalgo-charts/dist/openalgo-charts.profile.mjs
	function i(e, t) {
		let o = 0;
		for (let t = 1; t < e.length; t++) e[t] > e[o] && (o = t);
		let i = o, r = o, n = e[o] ?? 0;
		for (; n < t && (i > 0 || r < e.length - 1);) n += (i > 0 ? e[i - 1] : -1) >= (r < e.length - 1 ? e[r + 1] : -1) ? e[--i] : e[++r];
		return {
			poc: o,
			upper: i,
			lower: r
		};
	}
	var j = [
		"25755",
		"65656",
		"34443",
		"65556",
		"74747",
		"74744",
		"34553",
		"55755",
		"72227",
		"11152",
		"55655",
		"44447",
		"57755",
		"57555",
		"25552",
		"65644",
		"25573",
		"65655",
		"34216",
		"72222",
		"55557",
		"55552",
		"55775",
		"55255",
		"55222",
		"71247",
		"03137",
		"44656",
		"03443",
		"11353",
		"02743",
		"32722",
		"03531",
		"44655",
		"20223",
		"10152",
		"44565",
		"62223",
		"07755",
		"06555",
		"02552",
		"06564",
		"03511",
		"03444",
		"03216",
		"27223",
		"05553",
		"05552",
		"05577",
		"05225",
		"05531",
		"07127",
		"75557",
		"26227",
		"61247",
		"61216",
		"55711",
		"74616",
		"34752",
		"71222",
		"25252",
		"25716",
		"57575"
	];
	new Map(Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#", (e, t) => {
		const o = [];
		for (let e = 0; e < 5; e++) {
			const i = Number(j[t][e]);
			for (let t = 0; t < 3; t++) {
				if (!(i & 4 >> t)) continue;
				const r = t;
				for (; t + 1 < 3 && i & 4 >> t + 1;) t++;
				o.push([
					r,
					e,
					t - r + 1
				]);
			}
		}
		return [e, o];
	}));
	function Z(e) {
		let t = 1 / 0;
		for (let o = 1; o < e.length; o++) {
			const i = e[o - 1].price - e[o].price;
			i > 0 && (t = Math.min(t, i));
		}
		return t;
	}
	function G(e, t, o) {
		const i = Math.max(1e-7 * o, Math.max(Math.abs(e), Math.abs(t)) * Number.EPSILON * 8);
		return Number.isFinite(o) && e > t && Math.abs(e - t - o) <= i;
	}
	function J(e, t = 3, o, i = 0) {
		if (!Number.isFinite(t) || t <= 0) throw new RangeError("Imbalance ratio must be positive and finite");
		if (void 0 !== o && (!Number.isFinite(o) || o <= 0)) throw new RangeError("Imbalance rowSize must be positive and finite");
		if (!Number.isFinite(i) || i < 0) throw new RangeError("Imbalance threshold must be nonnegative and finite");
		const r = [...e].sort((e, t) => t.price - e.price), n = o ?? Z(r), l = (e, o) => e > 0 && e >= i && e >= t * o, s = [];
		for (let e = 0; e < r.length; e++) {
			const t = r[e], o = r[e + 1], i = r[e - 1];
			o && G(t.price, o.price, n) && l(t.askVol, o.bidVol) && s.push({
				price: t.price,
				side: "buy"
			}), i && G(i.price, t.price, n) && l(t.bidVol, i.askVol) && s.push({
				price: t.price,
				side: "sell"
			});
		}
		return s;
	}
	function ee(e, t = 3, o = 3, i, r = 0) {
		if (!Number.isSafeInteger(o) || o < 1) throw new RangeError("Imbalance minStack must be a positive integer");
		const n = [...e].sort((e, t) => t.price - e.price), l = J(n, t, i, r), s = i ?? Z(n), a = [];
		for (const e of ["buy", "sell"]) {
			const t = new Set(l.filter((t) => t.side === e).map((e) => e.price));
			let i;
			const r = () => {
				i && i.count >= o && a.push(i), i = void 0;
			};
			for (const o of n) t.has(o.price) ? (i && !G(i.endPrice, o.price, s) && r(), i ? (i.endPrice = o.price, i.count++) : i = {
				startPrice: o.price,
				endPrice: o.price,
				side: e,
				count: 1
			}) : r();
			r();
		}
		return a.sort((e, t) => t.startPrice - e.startPrice);
	}
	function oe(e) {
		const t = e.trim();
		if (t.startsWith("#")) {
			const e = t.slice(1);
			if (3 === e.length || 4 === e.length) {
				const [t, o, i, r] = [...e].map((e) => parseInt(e + e, 16));
				return [
					t,
					o,
					i
				].some(Number.isNaN) ? null : {
					r: t,
					g: o,
					b: i,
					a: 4 === e.length ? r / 255 : 1
				};
			}
			if (6 === e.length || 8 === e.length) {
				const t = parseInt(e.slice(0, 6), 16);
				if (Number.isNaN(t)) return null;
				const o = 8 === e.length ? parseInt(e.slice(6, 8), 16) / 255 : 1;
				return {
					r: t >> 16 & 255,
					g: t >> 8 & 255,
					b: 255 & t,
					a: Number.isNaN(o) ? 1 : o
				};
			}
			return null;
		}
		const o = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(t);
		return null === o ? null : {
			r: Number(o[1]),
			g: Number(o[2]),
			b: Number(o[3]),
			a: void 0 === o[4] ? 1 : Number(o[4])
		};
	}
	var ie = (e) => {
		const t = e / 255;
		return t <= .03928 ? t / 12.92 : Math.pow((t + .055) / 1.055, 2.4);
	};
	function re(e, t, o) {
		return e < t ? t : e > o ? o : e;
	}
	function ne(e) {
		return `rgb(${Math.round(e.r)},${Math.round(e.g)},${Math.round(e.b)})`;
	}
	function le(e, t, o) {
		return {
			r: e.r + (t.r - e.r) * o,
			g: e.g + (t.g - e.g) * o,
			b: e.b + (t.b - e.b) * o,
			a: 1
		};
	}
	function se(e) {
		return function(e) {
			return .2126 * ie(e.r) + .7152 * ie(e.g) + .0722 * ie(e.b);
		}({
			r: re(e.r, 0, 255),
			g: re(e.g, 0, 255),
			b: re(e.b, 0, 255),
			a: e.a
		});
	}
	function ae(e, t) {
		const o = oe(t);
		if (!o) return e;
		const i = se(o), r = (e) => {
			const t = se(e);
			return (Math.max(t, i) + .05) / (Math.min(t, i) + .05);
		}, n = (i + .05) / .05 >= 1.05 / (i + .05) ? 0 : 255, l = {
			r: n,
			g: n,
			b: n
		}, s = oe(e);
		if (!s) return ne(l);
		const a = le(o, s, Math.max(0, Math.min(1, s.a)));
		if (r(a) >= 4.5) return e;
		let c = 0, h = 1, u = l;
		for (let e = 0; e < 10; e++) {
			const e = (c + h) / 2, t = le(a, l, e), o = {
				r: Math.round(t.r),
				g: Math.round(t.g),
				b: Math.round(t.b),
				a: 1
			};
			r(o) >= 4.5 ? (h = e, u = o) : c = e;
		}
		return ne(u);
	}
	var ce = {
		widthFactor: .9,
		font: 10,
		minTextHeight: 11,
		textFade: 4,
		displayMode: "bidask",
		volumeDivisor: 1,
		cellStyle: "heatmap",
		textColorMode: "contrast",
		imbalanceRatio: 3,
		imbalanceThreshold: 0,
		stackedImbalances: 3,
		statsRows: [],
		tableRows: [],
		tableLabelWidth: 150,
		statsRowHeight: 15,
		statsPosition: "bottom",
		cvdOffset: 0,
		showCandle: !0,
		showPoc: !0,
		pocStyle: "marker",
		pocColor: "#f0a020",
		showValueArea: !1,
		valueAreaPercent: .7,
		radius: 2
	};
	function he(e) {
		if (!Number.isFinite(e)) return "-";
		const t = Number(e.toPrecision(3)), o = Math.abs(t), [i, r] = o >= 1e9 ? ["B", 1e9] : o >= 1e6 ? ["M", 1e6] : o >= 1e3 ? ["K", 1e3] : ["", 1];
		return String(Number((t / r).toPrecision(3))) + i;
	}
	function ue(e, t, o) {
		const i = oe(e), r = oe(t);
		if (null === i || null === r) return t;
		const n = Math.max(0, Math.min(1, o));
		return `rgb(${Math.round(i.r + (r.r - i.r) * n)},${Math.round(i.g + (r.g - i.g) * n)},${Math.round(i.b + (r.b - i.b) * n)})`;
	}
	var pe = {
		volume: "Volume",
		bidVolume: "Bid Volume",
		askVolume: "Ask Volume",
		delta: "Delta",
		minDelta: "Min Delta",
		maxDelta: "Max Delta",
		deltaPct: "Delta %",
		cvd: "CVD",
		trades: "Trades"
	};
	var de = {
		...pe,
		volume: "Total Volume",
		bidVolume: "Total Bid Volume",
		askVolume: "Total Ask Volume",
		cvd: "Cumulative Delta"
	};
	var me = class {
		constructor(e = {}) {
			Object.defineProperty(this, "_bars", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_opts", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_stats", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_cols", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_rc", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_inferredStep", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), this._opts = {
				...ce,
				...e,
				statsRows: [...e.statsRows ?? ce.statsRows],
				tableRows: [...e.tableRows ?? []]
			}, this._validateOptions(this._opts);
		}
		attached(e) {
			this._host = e;
		}
		detached() {
			this._host = null, this._rc = null, this._cols = [];
		}
		zOrder() {
			return "normal";
		}
		_validateOptions(e) {
			for (const t of [
				e.widthFactor,
				e.font,
				e.statsRowHeight,
				e.tableLabelWidth,
				e.imbalanceRatio,
				e.volumeDivisor
			]) if (!Number.isFinite(t) || t <= 0) throw new RangeError("Footprint dimensions and ratio must be positive and finite");
			for (const t of [
				e.radius,
				e.minTextHeight,
				e.textFade,
				e.imbalanceThreshold
			]) if (!Number.isFinite(t) || t < 0) throw new RangeError("Footprint thresholds and radius must be nonnegative and finite");
			for (const t of [e.cellWidth, e.tickSize]) if (void 0 !== t && (!Number.isFinite(t) || t <= 0)) throw new RangeError("Footprint width and row step must be positive and finite");
			if (!Number.isSafeInteger(e.stackedImbalances) || e.stackedImbalances < 0) throw new RangeError("Footprint stack length must be a nonnegative integer");
			if (!Number.isFinite(e.cvdOffset)) throw new RangeError("Footprint CVD offset must be finite");
			if (!Number.isFinite(e.valueAreaPercent) || e.valueAreaPercent <= 0 || e.valueAreaPercent > 1) throw new RangeError("Footprint value area must be in (0, 1]");
			for (const t of [e.statsRows, e.tableRows]) if (t.some((e) => !Object.prototype.hasOwnProperty.call(pe, e)) || new Set(t).size !== t.length) throw new RangeError("Footprint statistics rows must be known and unique");
		}
		setBars(e) {
			this._bars = e.map((e) => ({
				...e,
				cells: e.cells.map((e) => ({ ...e })).sort((e, t) => t.price - e.price)
			}));
			let t = 1 / 0;
			for (const e of this._bars) {
				void 0 !== e.rowSize && e.rowSize > 0 && (t = Math.min(t, e.rowSize));
				for (let o = 1; o < e.cells.length; o++) {
					const i = e.cells[o - 1].price - e.cells[o].price;
					i > 0 && (t = Math.min(t, i));
				}
			}
			this._inferredStep = Number.isFinite(t) ? t : 0, this._cols = [], this._recomputeStats(), this._host?.requestUpdate();
		}
		setOptions(e) {
			const t = {
				...this._opts,
				...e
			};
			this._validateOptions(t), this._opts = {
				...t,
				statsRows: [...t.statsRows],
				tableRows: [...t.tableRows]
			}, this._cols = [], void 0 === e.cvdOffset && void 0 === e.valueAreaPercent || this._recomputeStats(), this._host?.requestUpdate();
		}
		options() {
			return {
				...this._opts,
				statsRows: [...this._opts.statsRows],
				tableRows: [...this._opts.tableRows]
			};
		}
		stats() {
			return this._stats;
		}
		_step(e) {
			return this._opts.tickSize ?? e.rowSize ?? this._inferredStep;
		}
		autoscaleInfo() {
			let e = 1 / 0, t = -1 / 0;
			for (const o of this._bars) {
				const i = this._step(o) / 2;
				for (const r of o.cells) e = Math.min(e, r.price - i), t = Math.max(t, r.price + i);
				this._opts.showCandle && (void 0 !== o.low && (e = Math.min(e, o.low)), void 0 !== o.high && (t = Math.max(t, o.high)));
			}
			return Number.isFinite(e) ? {
				min: e,
				max: t
			} : null;
		}
		_recomputeStats() {
			let e = this._opts.cvdOffset;
			this._stats = this._bars.map((t) => {
				const o = t.cells.map((e) => e.bidVol + e.askVol), r = o.reduce((e, t) => e + t, 0), n = t.cells.reduce((e, t) => e + t.bidVol, 0), l = t.cells.reduce((e, t) => e + t.askVol, 0), s = i(o, r * this._opts.valueAreaPercent);
				return e += t.delta, {
					time: t.time,
					volume: r,
					bidVolume: n,
					askVolume: l,
					delta: t.delta,
					minDelta: t.minDelta ?? null,
					maxDelta: t.maxDelta ?? null,
					deltaPct: r > 0 ? t.delta / r * 100 : 0,
					cvd: e,
					trades: t.tradeCount ?? null,
					poc: t.cells[s.poc]?.price ?? 0,
					vah: t.cells[s.upper]?.price ?? 0,
					val: t.cells[s.lower]?.price ?? 0
				};
			});
		}
		_bounds(e, t, o) {
			const i = o.priceScale.priceToY(e);
			if (!(t > 0)) return {
				top: i - 8,
				bottom: i + 8
			};
			const r = o.priceScale.priceToY(e - t / 2), n = o.priceScale.priceToY(e + t / 2);
			return {
				top: Math.min(r, n),
				bottom: Math.max(r, n)
			};
		}
		draw(e, t) {
			if (this._rc = t, this._cols = [], 0 === this._bars.length || t.plotHeight <= 0 || t.plotWidth <= 0) return;
			const o = this._opts, i = t.dpr, r = o.buyColor ?? t.theme.upColor, n = o.sellColor ?? t.theme.downColor, l = t.theme.background, s = t.timeScale.barSpacing, a = Math.max(.1, Math.min(o.cellWidth ?? s * o.widthFactor, .96 * s)), c = o.showCandle && a >= 20 ? Math.min(9, .15 * a) : 0, h = Math.max(.1, a - c), u = o.tableRows.length ? o.tableRows : "bottom" === o.statsPosition ? o.statsRows : [], p = Math.min(t.plotHeight, u.length * o.statsRowHeight), d = t.plotHeight - p, m = t.timeScale.visibleRange();
			for (let e = 0; e < this._bars.length; e++) {
				const o = this._bars[e];
				if (!o.cells.length) continue;
				const i = t.dataLayer.timeToIndex(o.time);
				if (void 0 === i || i < m.from - 1 || i > m.to + 1) continue;
				const r = t.timeScale.indexToX(i) - a / 2 + c;
				r + h < 0 || r > t.plotWidth || this._cols.push({
					bar: o,
					stats: this._stats[e],
					x: r + h / 2,
					x0: r,
					width: h,
					rowSize: this._step(o),
					rows: []
				});
			}
			e.save(), e.beginPath(), e.rect(0, 0, t.plotWidth * i, t.plotHeight * i), e.clip(), e.textBaseline = "middle", e.save(), e.beginPath(), e.rect(0, 0, t.plotWidth * i, d * i), e.clip();
			for (const o of this._cols) this._drawColumn(e, t, o, c, r, n, l, d);
			if (e.restore(), o.statsRows.length && "bar" === o.statsPosition) for (const o of this._cols) this._drawCard(e, t, o, r, n, l, d);
			u.length && this._drawFooter(e, t, r, n, l, p, u), e.restore();
		}
		_drawColumn(e, t, o, i, r, n, l, s) {
			const a = this._opts, c = t.dpr, { bar: h, stats: u } = o, p = o.width * c, d = p / 2, m = o.x0 * c, f = o.x * c, b = J(h.cells, a.imbalanceRatio, o.rowSize || void 0, a.imbalanceThreshold), g = new Set(b.filter((e) => "buy" === e.side).map((e) => e.price)), w = new Set(b.filter((e) => "sell" === e.side).map((e) => e.price));
			let v = 0, M = 0;
			for (const e of h.cells) v = Math.max(v, "volume" === a.displayMode ? e.bidVol + e.askVol : "delta" === a.displayMode ? Math.abs(e.askVol - e.bidVol) : Math.max(e.bidVol, e.askVol)), M = Math.max(M, "bidask" === a.displayMode ? Math.max(e.bidVol, e.askVol) : e.bidVol + e.askVol);
			i > 0 && this._drawCandle(e, t, o, i, r, n);
			for (const i of h.cells) {
				const h = this._bounds(i.price, o.rowSize, t);
				if (h.bottom <= 0 || h.top >= s) continue;
				o.rows.push({
					cell: i,
					top: Math.max(0, h.top),
					bottom: Math.min(s, h.bottom)
				});
				const b = h.top * c, _ = (h.bottom - h.top) * c, x = Math.max(0, _ - Math.min(c, .1 * _)), y = Math.max(0, Math.min(1, (h.bottom - h.top - a.minTextHeight) / Math.max(1, a.textFade) + 1));
				if (e.font = a.font * c + "px ui-monospace, SFMono-Regular, Menlo, monospace", "bidask" === a.displayMode) {
					const o = Math.min(c, .08 * d), s = d - o;
					this._cell(e, t, i, m, b, s, x, i.bidVol, v, M, n, r, n, l, w.has(i.price), y, "bid"), this._cell(e, t, i, f + o, b, s, x, i.askVol, v, M, r, r, n, l, g.has(i.price), y, "ask");
				} else {
					const o = "delta" === a.displayMode ? i.askVol - i.bidVol : i.bidVol + i.askVol, s = i.askVol - i.bidVol;
					this._cell(e, t, i, m, b, p, x, o, v, M, s > 0 ? r : s < 0 ? n : ue(r, n, .5), r, n, l, s > 0 ? g.has(i.price) : s < 0 && w.has(i.price), y, "single");
				}
				a.showPoc && i.price === u.poc && ("outline" === a.pocStyle ? (e.strokeStyle = a.pocColor, e.lineWidth = Math.max(1, c), e.strokeRect(m, b + c / 2, p, Math.max(0, x - c))) : (e.fillStyle = a.pocColor, e.fillRect(m - 2 * c, b, 2 * c, x)));
			}
			if (a.showValueArea && u.volume > 0) {
				const i = this._bounds(u.vah, o.rowSize, t), r = this._bounds(u.val, o.rowSize, t);
				e.strokeStyle = a.valueAreaColor ?? t.theme.axisText, e.lineWidth = c, e.beginPath();
				for (const t of [Math.min(i.top, r.top), Math.max(i.bottom, r.bottom)]) e.moveTo(m, t * c), e.lineTo(m + p, t * c);
				e.stroke();
			}
			if (a.stackedImbalances > 0 && o.width >= 16) {
				const i = ee(h.cells, a.imbalanceRatio, a.stackedImbalances, o.rowSize || void 0, a.imbalanceThreshold);
				for (const l of i) {
					const i = this._bounds(l.startPrice, o.rowSize, t), s = this._bounds(l.endPrice, o.rowSize, t), a = Math.min(i.top, s.top) * c, h = Math.max(i.bottom, s.bottom) * c, u = ("buy" === l.side ? o.x0 + o.width - 1 : o.x0 + 1) * c, p = ("buy" === l.side ? -3 : 3) * c;
					e.strokeStyle = "buy" === l.side ? r : n, e.lineWidth = c, e.beginPath(), e.moveTo(u + p, a), e.lineTo(u, a), e.lineTo(u, h), e.lineTo(u + p, h), e.stroke();
				}
			}
		}
		_drawCandle(e, t, o, i, r, n) {
			const l = o.bar, s = t.dpr, a = (o.x0 - i / 2) * s, c = Math.min(4, .45 * i) * s, h = l.high ?? l.cells[0].price, u = l.low ?? l.cells[l.cells.length - 1].price, p = t.priceScale.priceToY(h) * s, d = t.priceScale.priceToY(u) * s, m = void 0 !== l.open && void 0 !== l.close;
			if (e.fillStyle = m ? l.close >= l.open ? r : n : t.theme.axisText, e.fillRect(a, Math.min(p, d), s, Math.max(s, Math.abs(d - p))), m) {
				const o = t.priceScale.priceToY(l.open) * s, i = t.priceScale.priceToY(l.close) * s;
				e.fillRect(a - c / 2, Math.min(o, i), c, Math.max(s, Math.abs(i - o)));
			}
		}
		_cell(e, t, o, i, r, n, l, s, a, c, h, u, p, d, m, f, b) {
			if (n <= 0 || l <= 0) return;
			const g = this._opts, w = t.dpr, v = "profile" === g.cellStyle, M = Math.max(0, Math.min(1, a > 0 ? Math.abs(s) / a : 0)), _ = m ? h : ue(d, h, "ladder" === g.cellStyle ? .18 + .82 * Math.sqrt(M) : .08 + .62 * Math.sqrt(M)), x = v ? n * M : n, y = v && "bid" === b ? i + n - x : i;
			if (x > 0 && (e.fillStyle = _, e.beginPath(), e.roundRect(y, r, x, l, "ladder" === g.cellStyle || v ? 0 : Math.min(g.radius * w, l / 2, x / 2)), e.fill()), f <= 0 || l < g.font * w * .6) return;
			const S = he(s / g.volumeDivisor), T = e.measureText(S).width;
			if (T + 4 * w > n) return;
			e.textAlign = v && "single" !== b ? "bid" === b ? "right" : "left" : "center";
			const k = v && "single" !== b ? "bid" === b ? i + n - 2 * w : i + 2 * w : i + n / 2, P = "right" === e.textAlign ? k - T : "left" === e.textAlign ? k : k - T / 2, C = P + T;
			let V = _;
			v && (0 === x || C <= y || P >= y + x ? V = d : (P < y || C > y + x) && (V = d, e.fillStyle = d, e.fillRect(P - w, r, T + 2 * w, l)));
			const A = g.textColor ?? ae(t.theme.axisText, d);
			e.fillStyle = function(e, t) {
				const o = oe(e);
				return null === o ? e : `rgba(${o.r},${o.g},${o.b},${t})`;
			}(function(e) {
				const { mode: t, side: o, bidVol: i, askVol: r, neutral: n, buy: l, sell: s } = e, a = r > i ? l : i > r ? s : n, c = "ask" === o ? l : "bid" === o ? s : a;
				let h = n;
				switch (t) {
					case "contrast": break;
					case "side":
						h = c;
						break;
					case "delta":
						h = a;
						break;
					case "dominant":
						("single" === o || "ask" === o && r > i || "bid" === o && i > r) && (h = a);
						break;
					case "imbalance":
						e.hot && (h = c);
						break;
					case "volume": {
						const t = "ask" === o ? r : "bid" === o ? i : r + i, l = e.peak > 0 ? Math.max(0, Math.min(1, t / e.peak)) : 0;
						if (l >= 1) h = c;
						else if (l > 0 && c !== n) {
							const e = oe(n), t = oe(c);
							e && t && (h = ne(le(e, t, l)));
						}
						break;
					}
				}
				return ae(oe(h) ? h : n, e.background);
			}({
				mode: g.textColorMode,
				side: b,
				bidVol: o.bidVol,
				askVol: o.askVol,
				peak: c,
				hot: m,
				neutral: A,
				buy: g.buyTextColor ?? u,
				sell: g.sellTextColor ?? p,
				background: V
			}), f), e.fillText(S, k, r + l / 2);
		}
		_drawCard(e, t, o, i, r, n, l) {
			const s = this._opts, a = t.dpr;
			if (o.width < 68 || 0 === o.rows.length) return;
			let c = -1 / 0;
			for (const e of o.bar.cells) c = Math.max(c, this._bounds(e.price, o.rowSize, t).bottom);
			if (s.showCandle) for (const e of [o.bar.high, o.bar.low]) void 0 !== e && (c = Math.max(c, t.priceScale.priceToY(e)));
			const h = c + 8, u = s.statsRows.length * s.statsRowHeight + 8;
			if (h < 0 || h + u > l) return;
			o.card = {
				top: h,
				bottom: h + u
			};
			const p = ue(n, t.theme.axisText, .13);
			e.fillStyle = p, e.beginPath(), e.roundRect(o.x0 * a, h * a, o.width * a, u * a, 2 * a), e.fill(), e.font = Math.max(8, s.font - 1) * a + "px ui-monospace, SFMono-Regular, Menlo, monospace", s.statsRows.forEach((n, l) => {
				const c = this._metric(o.stats, n), u = this._statText(c, n), d = (h + 4 + (l + .5) * s.statsRowHeight) * a, m = pe[n];
				e.measureText(m).width + e.measureText(u).width + 12 * a > o.width * a || (e.textAlign = "left", e.fillStyle = ae(s.textColor ?? t.theme.axisText, p), e.fillText(m, (o.x0 + 4) * a, d), e.textAlign = "right", e.fillStyle = ae(this._statColor(n, c, s.textColor ?? t.theme.axisText, s.buyTextColor ?? i, s.sellTextColor ?? r), p), e.fillText(u, (o.x0 + o.width - 4) * a, d));
			});
		}
		_drawFooter(e, t, o, i, r, n, l) {
			const s = this._opts, a = t.dpr, c = t.plotHeight - n, h = Math.min(s.tableLabelWidth, t.plotWidth);
			e.fillStyle = r, e.fillRect(0, c * a, t.plotWidth * a, n * a), e.font = Math.max(8, s.font - .5) * a + "px ui-monospace, SFMono-Regular, Menlo, monospace", e.textAlign = "center";
			const u = t.timeScale.barSpacing;
			for (const e of this._cols) {
				const o = t.timeScale.indexToX(t.dataLayer.timeToIndex(e.bar.time)), i = Math.max(h, o - u / 2), r = Math.min(t.plotWidth, o + u / 2);
				i < r && (e.table = {
					left: i,
					right: r,
					top: c,
					bottom: t.plotHeight
				});
			}
			e.save(), e.beginPath(), e.rect(h * a, c * a, (t.plotWidth - h) * a, n * a), e.clip(), l.forEach((n, l) => {
				let h = 1;
				for (const e of this._cols) e.table && (h = Math.max(h, Math.abs(this._metric(e.stats, n) ?? 0)));
				for (const p of this._cols) {
					if (!p.table) continue;
					const d = this._metric(p.stats, n), m = d ?? 0, f = ue(r, this._statColor(n, d, t.theme.axisText, o, i), .1 + .4 * Math.abs(m) / h), b = t.timeScale.indexToX(t.dataLayer.timeToIndex(p.bar.time)), g = (c + l * s.statsRowHeight) * a;
					e.fillStyle = f, e.fillRect((b - u / 2) * a, g + a, Math.max(0, u * a - a), Math.max(0, s.statsRowHeight * a - a));
					const w = this._statText(d, n), v = e.measureText(w).width / (2 * a) + 2;
					b - v < p.table.left || b + v > p.table.right || (e.fillStyle = ae(s.textColor ?? t.theme.axisText, f), e.fillText(w, b * a, g + s.statsRowHeight * a / 2));
				}
			}), e.restore(), e.save(), e.beginPath(), e.rect(0, c * a, h * a, n * a), e.clip();
			const p = ue(r, t.theme.axisText, .09);
			e.fillStyle = p, e.fillRect(0, c * a, h * a, n * a), e.fillStyle = ae(s.textColor ?? t.theme.axisText, p), e.textAlign = "left", l.forEach((t, o) => e.fillText(de[t], 6 * a, (c + (o + .5) * s.statsRowHeight) * a)), e.restore(), e.strokeStyle = ue(r, t.theme.axisText, .25), e.lineWidth = a, e.beginPath();
			for (let o = 0; o <= l.length; o++) {
				const i = (c + o * s.statsRowHeight) * a;
				e.moveTo(0, i), e.lineTo(t.plotWidth * a, i);
			}
			e.moveTo(h * a, c * a), e.lineTo(h * a, t.plotHeight * a), e.stroke();
		}
		_statColor(e, t, o, i, r) {
			return null === t || 0 === t || "volume" === e || "trades" === e ? o : "askVolume" === e ? i : "bidVolume" === e ? r : t > 0 ? i : r;
		}
		_metric(e, t) {
			return "deltaPct" === t ? e.deltaPct : e[t];
		}
		_statText(e, t) {
			if (null === e) return "-";
			if ("deltaPct" === t) return `${e >= 0 ? "+" : ""}${e.toFixed(1)}%`;
			const o = "trades" === t ? e : e / this._opts.volumeDivisor;
			return ((e) => "volume" === e || "trades" === e || "bidVolume" === e || "askVolume" === e)(t) ? he(o) : ((i = o) >= 0 ? "+" : "") + he(i);
			var i;
		}
		hitTest(e, t) {
			const o = this.hoverAt(e, t);
			return o ? {
				externalId: `footprint:${o.time}`,
				zOrder: "normal",
				distance: 0,
				cursor: "crosshair"
			} : null;
		}
		hoverAt(e, t, o) {
			const i = o ?? this._rc;
			if (!i || e < 0 || e > i.plotWidth || t < 0 || t > i.plotHeight) return null;
			const r = this._cols.find((o) => o.table && e >= o.table.left && e < o.table.right && t >= o.table.top && t <= o.table.bottom);
			if (r) return {
				time: r.bar.time,
				price: null,
				cell: null,
				stats: r.stats
			};
			const n = this._cols.find((t) => e >= t.x0 && e <= t.x0 + t.width);
			if (!n) return null;
			const l = n.rows.find((e) => t >= e.top && t < e.bottom);
			return l ? {
				time: n.bar.time,
				price: l.cell.price,
				cell: l.cell,
				stats: n.stats
			} : n.card && t >= n.card.top && t <= n.card.bottom ? {
				time: n.bar.time,
				price: null,
				cell: null,
				stats: n.stats
			} : null;
		}
	};
	//#endregion
	//#region ../../../../tmp/iq-foot-font-2IGZM4/control.ts
	var PROFILE_LEVEL_EXTENSION$1 = 8;
	var POC_MARKER_CELL_GAP$1 = 2;
	var FOOTPRINT_FONT_FAMILY$1 = "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace";
	var FOOTPRINT_LEVEL_COLOR$1 = "#6d3fa0";
	/** Presentation wrapper for pinned OpenAlgo 2.6.0, using its public drawing boundary. */
	function footprintColumn$1(options, spacing) {
		const annotation = options.statsPosition === "bar" && spacing >= 140 ? Math.min(42, spacing * .21) : 0;
		const column = Math.max(.1, Math.min(options.cellWidth ?? spacing * options.widthFactor, spacing * .96, annotation ? spacing - annotation * 2 - 12 : Infinity));
		const gap = options.showCandle && options.displayMode === "bidask" && column >= 32 ? Math.min(24, Math.max(12, column * .12)) : 0;
		return {
			column,
			gap,
			cells: column - gap,
			annotation
		};
	}
	var TerminalFootprint$1 = class extends me {
		paint = {
			at: 0,
			draws: 0,
			ms: 0,
			times: [],
			cells: 0
		};
		style;
		rowSize = 0;
		longest = 1;
		opacity = .85;
		cellFont = 10;
		cellFontPx = 10;
		dpr = 1;
		bars = [];
		rc;
		detached() {
			super.detached();
			this.rc = void 0;
			this.bars = [];
			this.centres = [];
			this.gap = 0;
		}
		gap = 0;
		renderWidth = -1;
		statsHeight = 15;
		configuringDraw = false;
		attached(host) {
			super.attached({
				...host,
				requestUpdate: () => {
					if (!this.configuringDraw) host.requestUpdate();
				}
			});
		}
		centres = [];
		cellText = false;
		valueAreaPath = false;
		pendingCellRect = null;
		cellHeightPx = 0;
		previousCellPaint = null;
		lastCellPaint = null;
		pocMarkerBounds = /* @__PURE__ */ new Map();
		pixelStrokeWidth() {
			return Math.max(1, Math.round(this.dpr));
		}
		alignStroke(value) {
			return Math.round(value) + (this.pixelStrokeWidth() % 2 ? .5 : 0);
		}
		alignCellRect(args) {
			const top = Math.round(args[1]);
			const bottom = Math.max(top + 1, Math.round(args[1] + args[3]));
			args[1] = top;
			args[3] = bottom - top;
			if (this.style.cellStyle !== "profile") {
				const left = Math.round(args[0]), right = Math.max(left + 1, Math.round(args[0] + args[2]));
				args[0] = left;
				args[2] = right - left;
			}
			if (typeof args[4] === "number") args[4] = Math.round(args[4]);
		}
		levelGuideColor() {
			return FOOTPRINT_LEVEL_COLOR$1;
		}
		alignedPocBounds(left, right) {
			const edge = this.rc ? this.rc.plotWidth * this.dpr : Infinity;
			left = Math.max(0, Math.min(edge, left));
			right = Math.max(0, Math.min(edge, right));
			const markerWidth = this.pixelStrokeWidth() * 2;
			const alignMarker = (value) => Math.round(value) + (markerWidth % 2 ? .5 : 0);
			return [alignMarker(left), alignMarker(right)];
		}
		pocHorizontalBounds(left, right, centreY) {
			if (this.style.showValueArea) return [this.alignStroke(this.extendProfileLevel(left, "left")), this.alignStroke(this.extendProfileLevel(right, "right"))];
			const tolerance = Math.max(1, this.dpr);
			const rowCells = [this.previousCellPaint, this.lastCellPaint].filter((cell) => !!cell && Math.abs(cell.y + cell.height / 2 - centreY) <= tolerance && cell.x >= left - tolerance && cell.x + cell.width <= right + tolerance);
			const actualLeft = rowCells.length ? Math.min(...rowCells.map((cell) => cell.x)) : left;
			const actualRight = rowCells.length ? Math.max(...rowCells.map((cell) => cell.x + cell.width)) : right;
			const offset = POC_MARKER_CELL_GAP$1 * this.dpr + this.pixelStrokeWidth();
			return this.alignedPocBounds(actualLeft - offset, actualRight + offset);
		}
		shiftedX(x) {
			const centre = this.centres.find((c) => Math.abs(x / this.dpr - c) <= this.renderWidth / 2 + 1);
			return centre === void 0 ? x : x + (x / this.dpr < centre ? -this.gap / 2 : this.gap / 2) * this.dpr;
		}
		extendProfileLevel(x, side) {
			const edge = this.rc ? this.rc.plotWidth * this.dpr : Infinity;
			const endpoint = x + (side === "left" ? -1 : 1) * PROFILE_LEVEL_EXTENSION$1 * this.dpr;
			return Math.max(0, Math.min(edge, endpoint));
		}
		contexts = /* @__PURE__ */ new WeakMap();
		constructor(options) {
			super({
				...options,
				showCandle: false
			});
			this.style = { ...options };
			this.statsHeight = options.statsRowHeight;
		}
		setCellOpacity(opacity) {
			this.opacity = Math.max(0, Math.min(1, opacity));
		}
		options() {
			return {
				...this.style,
				statsRowHeight: this.statsHeight,
				statsRows: [...this.style.statsRows],
				tableRows: [...this.style.tableRows]
			};
		}
		setOptions(options) {
			this.style = {
				...this.style,
				...options
			};
			this.renderWidth = -1;
			super.setOptions({
				...options,
				showCandle: false
			});
		}
		setBars(bars) {
			this.bars = bars;
			this.rowSize = bars[0]?.rowSize ?? 0;
			this.longest = 1;
			for (const bar of bars) for (const cell of bar.cells) for (const value of [
				cell.bidVol,
				cell.askVol,
				cell.bidVol + cell.askVol,
				cell.askVol - cell.bidVol
			]) this.longest = Math.max(this.longest, he(value / this.style.volumeDivisor).length);
			super.setBars(bars);
		}
		draw(ctx, rc) {
			const paintStarted = performance.now();
			this.dpr = rc.dpr;
			this.valueAreaPath = false;
			this.pendingCellRect = null;
			this.previousCellPaint = null;
			this.lastCellPaint = null;
			this.pocMarkerBounds.clear();
			const o = this.style, spacing = rc.timeScale.barSpacing;
			const geometry = footprintColumn$1(o, spacing);
			this.rc = rc;
			this.gap = geometry.gap;
			const rows = o.tableRows.length || (o.statsPosition === "bottom" ? o.statsRows.length : 0);
			const statsHeight = rows ? Math.min(o.statsRowHeight, Math.max(8, Math.floor(rc.plotHeight * .4 / rows))) : o.statsRowHeight;
			if (this.renderWidth !== geometry.cells || this.statsHeight !== statsHeight) {
				this.statsHeight = statsHeight;
				this.renderWidth = geometry.cells;
				this.configuringDraw = true;
				try {
					super.setOptions({
						cellWidth: geometry.cells,
						showCandle: false,
						statsRowHeight: statsHeight,
						statsRows: o.statsPosition === "bar" ? [] : o.statsRows
					});
				} finally {
					this.configuringDraw = false;
				}
			}
			this.centres = this.bars.flatMap((bar) => {
				const i = rc.dataLayer.timeToIndex(bar.time);
				return i === void 0 ? [] : [rc.timeScale.indexToX(i)];
			});
			const width = geometry.cells / (o.displayMode === "bidask" ? 2 : 1);
			const step = o.tickSize ?? this.rowSize, range = rc.priceScale.priceRange();
			const height = Math.abs(rc.priceScale.priceToY(range.min + step) - rc.priceScale.priceToY(range.min));
			this.cellHeightPx = height * this.dpr;
			const fittedFont = Math.max(9, Math.min(24, height * .75, (width - 4) / (this.longest * .6)));
			const minDeviceFont = Math.ceil(9 * this.dpr), maxDeviceFont = Math.floor(24 * this.dpr);
			this.cellFontPx = Math.min(maxDeviceFont, Math.max(minDeviceFont, Math.floor(fittedFont * this.dpr)));
			this.cellFont = this.cellFontPx / this.dpr;
			let proxy = this.contexts.get(ctx);
			if (!proxy) {
				const methods = /* @__PURE__ */ new Map();
				proxy = new Proxy(ctx, {
					set: (target, key, value) => {
						if (key === "strokeStyle") this.valueAreaPath = this.style.showValueArea && value === this.style.valueAreaColor;
						this.cellText = key === "font" ? value === `${this.style.font * this.dpr}px ui-monospace, SFMono-Regular, Menlo, monospace` : this.cellText;
						if (key === "font" && value === `${this.style.font * this.dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`) value = `600 ${this.cellFontPx}px ${FOOTPRINT_FONT_FAMILY$1}`;
						return Reflect.set(target, key, value, target);
					},
					get: (target, key) => {
						if (key === "moveTo" || key === "lineTo" || key === "stroke") {
							if (!methods.has(key)) methods.set(key, (...args) => {
								if (this.valueAreaPath) {
									if (key === "stroke") {
										const dash = this.pixelStrokeWidth();
										target.save();
										target.setLineDash([dash * 3, dash * 2]);
										target.strokeStyle = this.levelGuideColor();
										target.globalAlpha = 1;
										target.lineWidth = dash * 2;
										try {
											return target.stroke.apply(target, args);
										} finally {
											target.restore();
										}
									}
									if (this.gap) args[0] = this.shiftedX(args[0]);
									args[0] = this.alignStroke(this.extendProfileLevel(args[0], key === "moveTo" ? "left" : "right"));
									args[1] = this.alignStroke(args[1]);
								}
								return target[key].apply(target, args);
							});
							return methods.get(key);
						}
						if (key === "roundRect" || key === "fillText" || key === "fillRect" || key === "strokeRect") {
							if (!methods.has(key)) methods.set(key, (...args) => {
								if (key === "fillRect" && this.cellText && this.style.cellStyle === "profile" && target.fillStyle === this.rc?.theme.background) return;
								const poc = key === "strokeRect" && Math.abs(args[2] / this.dpr - this.renderWidth) < .01;
								if (this.gap && (key === "roundRect" ? args[2] <= this.renderWidth * this.dpr / 2 : poc || this.cellText)) {
									const index = key === "fillText" ? 1 : 0;
									if (key === "strokeRect" && Math.abs(args[2] / this.dpr - this.renderWidth) < .01) {
										args[0] -= this.gap * this.dpr / 2;
										args[2] += this.gap * this.dpr;
									} else {
										const anchor = args[index] + (key === "fillText" ? 0 : args[2] / 2);
										args[index] += this.shiftedX(anchor) - anchor;
									}
								}
								if (key === "roundRect") {
									this.alignCellRect(args);
									this.pendingCellRect = this.isCellBackground([
										args[0],
										args[1],
										args[2],
										args[3]
									]) ? [
										args[0],
										args[1],
										args[2],
										args[3]
									] : null;
								}
								if (key === "fillRect" && this.cellText) this.rememberCellPaint([
									args[0],
									args[1],
									args[2],
									args[3]
								], target.fillStyle, target.globalAlpha);
								if (key === "fillText" && this.cellText) {
									args[1] = Math.round(args[1]);
									args[2] = Math.round(args[2]);
								}
								if (poc) {
									const rawLeft = args[0], rawRight = args[0] + args[2];
									const centreY = args[1] + args[3] / 2;
									const [left, right] = this.pocHorizontalBounds(rawLeft, rawRight, centreY);
									this.pocMarkerBounds.set(Math.round((rawLeft + rawRight) / 2), [left, right]);
									args[0] = left;
									args[2] = Math.max(0, right - args[0]);
									const top = this.alignStroke(args[1]), bottom = this.alignStroke(args[1] + args[3]);
									args[1] = top;
									args[3] = Math.max(1, bottom - top);
									const rightEdge = args[0] + args[2], bottomEdge = args[1] + args[3];
									const dash = this.pixelStrokeWidth();
									target.save();
									target.setLineDash([dash * 3, dash * 2]);
									target.strokeStyle = this.levelGuideColor();
									target.globalAlpha = 1;
									target.lineWidth = dash * 2;
									try {
										const marker = new Path2D();
										marker.moveTo(args[0], top);
										marker.lineTo(args[0], bottomEdge);
										marker.moveTo(rightEdge, top);
										marker.lineTo(rightEdge, bottomEdge);
										return target.stroke(marker);
									} finally {
										target.restore();
									}
								}
								if (key === "fillText" && this.cellText && typeof target.fillStyle === "string") {
									const textColor = target.fillStyle;
									const textAlpha = target.globalAlpha;
									const adjusted = readableTextColor$1(textColor, this.cellTextBackgrounds(args, target), textAlpha, !this.style.textColor);
									target.fillStyle = adjusted?.color ?? opaqueTextColor$1(textColor);
									if (adjusted) target.globalAlpha = adjusted.alpha;
									try {
										if (adjusted?.outline) {
											target.save();
											try {
												target.strokeStyle = adjusted.outline;
												target.lineWidth = this.pixelStrokeWidth();
												target.lineJoin = "round";
												target.setLineDash([]);
												target.shadowBlur = 0;
												target.shadowOffsetX = 0;
												target.shadowOffsetY = 0;
												target.shadowColor = "rgba(0,0,0,0)";
												if (typeof args[3] === "number") target.strokeText(String(args[0]), args[1], args[2], args[3]);
												else target.strokeText(String(args[0]), args[1], args[2]);
											} finally {
												target.restore();
											}
										}
										return target[key].apply(target, args);
									} finally {
										target.fillStyle = textColor;
										target.globalAlpha = textAlpha;
									}
								}
								return target[key].apply(target, args);
							});
							return methods.get(key);
						}
						if (key === "fill") {
							if (!methods.has(key)) methods.set(key, (...args) => {
								const alpha = target.globalAlpha;
								const cellBackground = this.pendingCellRect !== null;
								if (cellBackground) this.rememberCellPaint(this.pendingCellRect, target.fillStyle, alpha * this.opacity);
								this.pendingCellRect = null;
								if (cellBackground) target.globalAlpha = alpha * this.opacity;
								try {
									target.fill(...args);
								} finally {
									target.globalAlpha = alpha;
								}
							});
							return methods.get(key);
						}
						const value = Reflect.get(target, key, target);
						if (typeof value !== "function") return value;
						if (!methods.has(key)) methods.set(key, value.bind(target));
						return methods.get(key);
					}
				});
				this.contexts.set(ctx, proxy);
			}
			super.draw(proxy, rc);
			const visible = rc.timeScale.visibleRange(), priceRange = rc.priceScale.priceRange();
			this.paint.times = [];
			this.paint.cells = 0;
			for (const bar of this.bars) {
				const index = rc.dataLayer.timeToIndex(bar.time);
				if (index === void 0 || index < visible.from - .5 || index > visible.to + .5) continue;
				const cells = bar.cells.filter((cell) => cell.price + (bar.rowSize || this.rowSize) >= priceRange.min && cell.price <= priceRange.max).length;
				if (cells) {
					this.paint.times.push(bar.time);
					this.paint.cells += cells;
				}
			}
			if (o.statsPosition === "bar") this.drawBarTotals(ctx, rc);
			if (this.bars.length && o.showCandle) this.drawCandles(ctx, rc);
			this.paint.at = performance.now();
			this.paint.draws++;
			this.paint.ms = this.paint.at - paintStarted;
		}
		rememberCellPaint(rect, fillStyle, alpha) {
			if (typeof fillStyle !== "string") return;
			const fill = parseRgbColor$1(fillStyle), base = parseRgbColor$1(this.rc?.theme.background ?? "");
			if (!fill || !base) return;
			const opacity = Math.max(0, Math.min(1, alpha * fill.a));
			this.previousCellPaint = this.lastCellPaint;
			this.lastCellPaint = {
				x: rect[0],
				y: rect[1],
				width: rect[2],
				height: rect[3],
				background: compositeColor$1(fill, base, opacity)
			};
		}
		isCellBackground(rect) {
			const [x, y, width, height] = rect, rc = this.rc;
			const rows = this.style.tableRows.length || (this.style.statsPosition === "bottom" ? this.style.statsRows.length : 0);
			const contentHeight = rc ? Math.max(0, rc.plotHeight - rows * this.statsHeight) * this.dpr : 0;
			if (!rc || this.cellHeightPx <= 0 || Math.abs(height - this.cellHeightPx) > Math.max(2, this.dpr) || width <= 0 || width > this.renderWidth * this.dpr + 1 || y + height <= 0 || y >= contentHeight) return false;
			const halfBar = (this.renderWidth + this.gap) * this.dpr / 2 + 1;
			return this.centres.some((centre) => x >= centre * this.dpr - halfBar && x + width <= centre * this.dpr + halfBar);
		}
		cellTextBackgrounds(args, target) {
			const cell = this.lastCellPaint, themeBackground = parseRgbColor$1(this.rc?.theme.background ?? "");
			const backgrounds = themeBackground ? [themeBackground] : [];
			if (!cell) return backgrounds;
			const width = target.measureText(String(args[0])).width;
			const anchor = args[1];
			const left = target.textAlign === "center" ? anchor - width / 2 : target.textAlign === "right" || target.textAlign === "end" ? anchor - width : anchor;
			const right = left + width;
			const outlinePad = this.pixelStrokeWidth() / 2;
			const textTop = args[2] - this.cellFontPx / 2 - outlinePad, textBottom = args[2] + this.cellFontPx / 2 + outlinePad;
			if (!(right > cell.x && left < cell.x + cell.width && textBottom > cell.y && textTop < cell.y + cell.height)) return backgrounds;
			if (left - outlinePad >= cell.x && right + outlinePad <= cell.x + cell.width && textTop >= cell.y && textBottom <= cell.y + cell.height) return [cell.background];
			if (!backgrounds.some((background) => background.r === cell.background.r && background.g === cell.background.g && background.b === cell.background.b)) backgrounds.push(cell.background);
			return backgrounds;
		}
		/** Native per-bar totals use the complete gap to each neighbouring histogram. */
		drawBarTotals(ctx, rc) {
			const o = this.style, spacing = rc.timeScale.barSpacing;
			const { column, annotation } = footprintColumn$1(o, spacing);
			if (!annotation) return;
			const dpr = rc.dpr, physicalFont = Math.max(1, Math.round(9 * dpr));
			const markerOffset = o.showPoc && o.pocStyle === "outline" ? POC_MARKER_CELL_GAP$1 + this.pixelStrokeWidth() / dpr : 0;
			const gap = Math.max(3, 4 - markerOffset);
			const footerRows = o.tableRows.length ? o.tableRows.length : 0;
			const contentHeight = Math.max(0, rc.plotHeight - footerRows * this.statsHeight);
			const background = parseRgbColor$1(rc.theme.background);
			const neutralColor = o.textColor ?? rc.theme.axisText;
			const stats = this.stats();
			const centres = this.bars.map((bar) => {
				const index = rc.dataLayer.timeToIndex(bar.time);
				return index === void 0 ? void 0 : rc.timeScale.indexToX(index);
			});
			const labels = [];
			const leftLabels = [];
			const rightLabels = [];
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, rc.plotWidth * dpr, contentHeight * dpr);
			ctx.clip();
			ctx.font = `${physicalFont}px ui-monospace, SFMono-Regular, Menlo, monospace`;
			ctx.textBaseline = "middle";
			ctx.globalAlpha = 1;
			for (let n = 0; n < this.bars.length; n++) {
				const bar = this.bars[n], totals = stats[n];
				const index = rc.dataLayer.timeToIndex(bar.time);
				if (index === void 0 || !totals || !bar.cells.length) continue;
				const centre = rc.timeScale.indexToX(index), y = Math.round(rc.priceScale.priceToY(totals.poc) * dpr);
				if (!Number.isFinite(y) || y < 0 || y > contentHeight * dpr) continue;
				const [leftMark, rightMark] = this.pocMarkerBounds.get(Math.round(centre * dpr)) ?? this.alignedPocBounds((centre - column / 2) * dpr, (centre + column / 2) * dpr);
				const previousCentre = centres[n - 1], nextCentre = centres[n + 1];
				const leftSlot = Math.max(0, previousCentre === void 0 ? 0 : previousCentre + column / 2);
				const rightSlot = Math.min(rc.plotWidth, nextCentre === void 0 ? rc.plotWidth : nextCentre - column / 2);
				const leftX = Math.round((leftMark / dpr - gap) * dpr), rightX = Math.round((rightMark / dpr + gap) * dpr);
				const leftAvailable = Math.max(0, leftMark / dpr - gap - leftSlot) * dpr;
				const rightAvailable = Math.max(0, rightSlot - rightMark / dpr - gap) * dpr;
				const volume = he(totals.volume / o.volumeDivisor);
				const delta = `${totals.delta >= 0 ? "+" : ""}${he(totals.delta / o.volumeDivisor)}`;
				const volumeWidth = ctx.measureText(volume).width, deltaWidth = ctx.measureText(delta).width;
				const deltaColor = totals.delta === 0 ? neutralColor : totals.delta > 0 ? o.buyTextColor ?? rc.theme.upColor : o.sellTextColor ?? rc.theme.downColor;
				if (volumeWidth <= leftAvailable) {
					const label = {
						side: "left",
						value: volume,
						x: leftX,
						y,
						width: volumeWidth,
						color: neutralColor,
						visible: true
					};
					labels.push(label);
					leftLabels[n] = label;
				}
				if (deltaWidth <= rightAvailable) {
					const label = {
						side: "right",
						value: delta,
						x: rightX,
						y,
						width: deltaWidth,
						color: deltaColor,
						visible: true
					};
					labels.push(label);
					rightLabels[n] = label;
				}
			}
			for (let n = 0; n + 1 < this.bars.length; n++) {
				const delta = rightLabels[n], volume = leftLabels[n + 1];
				if (!delta || !volume) continue;
				const horizontal = Math.max(delta.x, volume.x - volume.width) < Math.min(delta.x + delta.width, volume.x) - 1;
				const vertical = Math.abs(delta.y - volume.y) < physicalFont;
				if (!horizontal || !vertical) continue;
				if (delta.width <= volume.width) volume.visible = false;
				else delta.visible = false;
			}
			for (const label of labels) {
				if (!label.visible) continue;
				const readable = readableTextColor$1(label.color, background ? [background] : [], 1, true) ?? {
					color: opaqueTextColor$1(label.color),
					alpha: 1
				};
				ctx.textAlign = label.side === "left" ? "right" : "left";
				ctx.fillStyle = readable.color;
				ctx.globalAlpha = 1;
				if (readable.outline) {
					ctx.save();
					try {
						ctx.strokeStyle = readable.outline;
						ctx.lineWidth = this.pixelStrokeWidth();
						ctx.lineJoin = "round";
						ctx.setLineDash([]);
						ctx.shadowBlur = 0;
						ctx.shadowOffsetX = 0;
						ctx.shadowOffsetY = 0;
						ctx.shadowColor = "rgba(0,0,0,0)";
						ctx.strokeText(label.value, label.x, label.y);
					} finally {
						ctx.restore();
					}
				}
				ctx.fillText(label.value, label.x, label.y);
			}
			ctx.restore();
		}
		drawCandles(ctx, rc) {
			const o = this.style, dpr = rc.dpr;
			const rows = o.tableRows.length || (o.statsPosition === "bottom" ? o.statsRows.length : 0);
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, rc.plotWidth * dpr, Math.max(0, rc.plotHeight - rows * this.statsHeight) * dpr);
			ctx.clip();
			for (const bar of this.bars) {
				const index = rc.dataLayer.timeToIndex(bar.time);
				if (index === void 0 || bar.open === void 0 || bar.close === void 0 || bar.high === void 0 || bar.low === void 0) continue;
				const x = rc.timeScale.indexToX(index);
				if (x < 0 || x > rc.plotWidth) continue;
				const centre = this.gap ? x : x - footprintColumn$1(o, rc.timeScale.barSpacing).column / 2 - 6;
				const bodyWidth = Math.min(8, Math.max(2, this.gap ? this.gap * .4 : rc.timeScale.barSpacing * .06));
				const high = rc.priceScale.priceToY(bar.high), low = rc.priceScale.priceToY(bar.low);
				const open = rc.priceScale.priceToY(bar.open), close = rc.priceScale.priceToY(bar.close);
				ctx.fillStyle = bar.close >= bar.open ? o.buyColor ?? rc.theme.upColor : o.sellColor ?? rc.theme.downColor;
				const wickWidth = Math.max(1, Math.round(dpr));
				const wickLeft = Math.round((centre - .5) * dpr);
				const wickTop = Math.round(Math.min(high, low) * dpr), wickBottom = Math.round(Math.max(high, low) * dpr);
				const bodyLeft = Math.round((centre - bodyWidth / 2) * dpr), bodyRight = Math.round((centre + bodyWidth / 2) * dpr);
				const bodyTop = Math.round(Math.min(open, close) * dpr), bodyBottom = Math.round(Math.max(open, close) * dpr);
				ctx.fillRect(wickLeft, wickTop, wickWidth, Math.max(wickWidth, wickBottom - wickTop));
				ctx.fillRect(bodyLeft, bodyTop, Math.max(1, bodyRight - bodyLeft), Math.max(wickWidth, bodyBottom - bodyTop));
			}
			ctx.restore();
		}
		hoverAt(x, y, rc) {
			const context = rc ?? this.rc;
			if (!context || !this.gap) return super.hoverAt(x, y, rc);
			const rows = this.style.tableRows.length || (this.style.statsPosition === "bottom" ? this.style.statsRows.length : 0);
			if (y >= context.plotHeight - rows * this.statsHeight) return super.hoverAt(x, y, context);
			const centre = this.centres.find((c) => Math.abs(x - c) <= (this.renderWidth + this.gap) / 2);
			if (centre === void 0 || Math.abs(x - centre) < this.gap / 2) return null;
			return super.hoverAt(x + (x < centre ? this.gap / 2 : -this.gap / 2), y, context);
		}
	};
	function opaqueTextColor$1(color) {
		const rgba = /^rgba\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*[^)]+\)$/i.exec(color);
		return rgba ? `rgb(${rgba[1].trim()}, ${rgba[2].trim()}, ${rgba[3].trim()})` : color;
	}
	function parseRgbColor$1(color) {
		const key = color.trim();
		if (RGB_COLOR_CACHE$1.has(key)) return RGB_COLOR_CACHE$1.get(key) ?? null;
		const parsed = parseRgbColorUncached$1(key);
		RGB_COLOR_CACHE$1.set(key, parsed);
		if (RGB_COLOR_CACHE$1.size > 64) RGB_COLOR_CACHE$1.delete(RGB_COLOR_CACHE$1.keys().next().value);
		return parsed;
	}
	var RGB_COLOR_CACHE$1 = /* @__PURE__ */ new Map();
	function parseRgbColorUncached$1(color) {
		const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color);
		if (hex) {
			const value = hex[1].length === 3 ? [...hex[1]].map((channel) => channel + channel).join("") : hex[1];
			return {
				r: parseInt(value.slice(0, 2), 16),
				g: parseInt(value.slice(2, 4), 16),
				b: parseInt(value.slice(4, 6), 16),
				a: 1
			};
		}
		const match = /^rgba?\(([^)]+)\)$/i.exec(color);
		if (!match) return null;
		const parts = match[1].trim().split(/[\s,/]+/);
		if (parts.length < 3) return null;
		const channel = (part) => {
			const value = Number.parseFloat(part);
			return Number.isFinite(value) ? Math.max(0, Math.min(255, part.endsWith("%") ? value * 2.55 : value)) : NaN;
		};
		const r = channel(parts[0]), g = channel(parts[1]), b = channel(parts[2]);
		const alphaValue = parts[3] === void 0 ? 1 : Number.parseFloat(parts[3]);
		if (![
			r,
			g,
			b,
			alphaValue
		].every(Number.isFinite)) return null;
		return {
			r,
			g,
			b,
			a: Math.max(0, Math.min(1, alphaValue))
		};
	}
	function compositeColor$1(foreground, background, alpha) {
		return {
			r: foreground.r * alpha + background.r * (1 - alpha),
			g: foreground.g * alpha + background.g * (1 - alpha),
			b: foreground.b * alpha + background.b * (1 - alpha),
			a: 1
		};
	}
	function relativeLuminance$1(color) {
		const linear = (value) => {
			const channel = value / 255;
			return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
		};
		return .2126 * linear(color.r) + .7152 * linear(color.g) + .0722 * linear(color.b);
	}
	function contrastRatio$1(first, second) {
		const a = relativeLuminance$1(first), b = relativeLuminance$1(second);
		return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
	}
	function readableTextColor$1(color, backgrounds, globalAlpha, forceOpaque) {
		const foreground = parseRgbColor$1(color);
		if (!foreground) return null;
		const opaque = {
			...foreground,
			a: 1
		};
		const effectiveAlpha = Math.max(0, Math.min(1, globalAlpha * (forceOpaque ? 1 : foreground.a)));
		if (backgrounds.map((background) => compositeColor$1(foreground, background, effectiveAlpha)).every((colorAtCell, index) => contrastRatio$1(colorAtCell, backgrounds[index]) >= 4.5)) return {
			color: forceOpaque ? `rgb(${Math.round(opaque.r)}, ${Math.round(opaque.g)}, ${Math.round(opaque.b)})` : color,
			alpha: globalAlpha
		};
		const black = {
			r: 0,
			g: 0,
			b: 0,
			a: 1
		}, white = {
			r: 255,
			g: 255,
			b: 255,
			a: 1
		};
		const minimumContrast = (foreground) => backgrounds.length ? Math.min(...backgrounds.map((background) => contrastRatio$1(foreground, background))) : 0;
		const whiteContrast = minimumContrast(white), blackContrast = minimumContrast(black);
		if (whiteContrast >= 4.5 || blackContrast >= 4.5) return whiteContrast >= blackContrast ? {
			color: "rgb(255, 255, 255)",
			alpha: 1
		} : {
			color: "rgb(0, 0, 0)",
			alpha: 1
		};
		return whiteContrast >= blackContrast ? {
			color: "rgb(255, 255, 255)",
			alpha: 1,
			outline: "rgb(0, 0, 0)"
		} : {
			color: "rgb(0, 0, 0)",
			alpha: 1,
			outline: "rgb(255, 255, 255)"
		};
	}
	//#endregion
	//#region src/chart/terminal-footprint.ts
	var PROFILE_LEVEL_EXTENSION = 8;
	var POC_MARKER_CELL_GAP = 2;
	var FOOTPRINT_FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace";
	var FOOTPRINT_LEVEL_COLOR = "#6d3fa0";
	/** Presentation wrapper for pinned OpenAlgo 2.6.0, using its public drawing boundary. */
	function footprintColumn(options, spacing) {
		const annotation = options.statsPosition === "bar" && spacing >= 140 ? Math.min(42, spacing * .21) : 0;
		const column = Math.max(.1, Math.min(options.cellWidth ?? spacing * options.widthFactor, spacing * .96, annotation ? spacing - annotation * 2 - 12 : Infinity));
		const gap = options.showCandle && options.displayMode === "bidask" && column >= 32 ? Math.min(24, Math.max(12, column * .12)) : 0;
		return {
			column,
			gap,
			cells: column - gap,
			annotation
		};
	}
	var TerminalFootprint = class extends me {
		paint = {
			at: 0,
			draws: 0,
			ms: 0,
			times: [],
			cells: 0
		};
		style;
		rowSize = 0;
		longest = 1;
		opacity = .85;
		cellFont = 10;
		cellFontPx = 10;
		nativeCellFont = "";
		paintedCellFont = "";
		dpr = 1;
		bars = [];
		rc;
		detached() {
			super.detached();
			this.rc = void 0;
			this.bars = [];
			this.centres = [];
			this.gap = 0;
		}
		gap = 0;
		renderWidth = -1;
		fontEpoch = 0;
		statsHeight = 15;
		configuringDraw = false;
		attached(host) {
			super.attached({
				...host,
				requestUpdate: () => {
					if (!this.configuringDraw) host.requestUpdate();
				}
			});
		}
		centres = [];
		cellText = false;
		valueAreaPath = false;
		pendingCellRect = null;
		cellHeightPx = 0;
		previousCellPaint = null;
		lastCellPaint = null;
		pocMarkerBounds = /* @__PURE__ */ new Map();
		pixelStrokeWidth() {
			return Math.max(1, Math.round(this.dpr));
		}
		alignStroke(value) {
			return Math.round(value) + (this.pixelStrokeWidth() % 2 ? .5 : 0);
		}
		alignCellRect(args) {
			const top = Math.round(args[1]);
			const bottom = Math.max(top + 1, Math.round(args[1] + args[3]));
			args[1] = top;
			args[3] = bottom - top;
			if (this.style.cellStyle !== "profile") {
				const left = Math.round(args[0]), right = Math.max(left + 1, Math.round(args[0] + args[2]));
				args[0] = left;
				args[2] = right - left;
			}
			if (typeof args[4] === "number") args[4] = Math.round(args[4]);
		}
		levelGuideColor() {
			return FOOTPRINT_LEVEL_COLOR;
		}
		alignedPocBounds(left, right) {
			const edge = this.rc ? this.rc.plotWidth * this.dpr : Infinity;
			left = Math.max(0, Math.min(edge, left));
			right = Math.max(0, Math.min(edge, right));
			const markerWidth = this.pixelStrokeWidth() * 2;
			const alignMarker = (value) => Math.round(value) + (markerWidth % 2 ? .5 : 0);
			return [alignMarker(left), alignMarker(right)];
		}
		pocHorizontalBounds(left, right, centreY) {
			if (this.style.showValueArea) return [this.alignStroke(this.extendProfileLevel(left, "left")), this.alignStroke(this.extendProfileLevel(right, "right"))];
			const tolerance = Math.max(1, this.dpr);
			const rowCells = [this.previousCellPaint, this.lastCellPaint].filter((cell) => !!cell && Math.abs(cell.y + cell.height / 2 - centreY) <= tolerance && cell.x >= left - tolerance && cell.x + cell.width <= right + tolerance);
			const actualLeft = rowCells.length ? Math.min(...rowCells.map((cell) => cell.x)) : left;
			const actualRight = rowCells.length ? Math.max(...rowCells.map((cell) => cell.x + cell.width)) : right;
			const offset = POC_MARKER_CELL_GAP * this.dpr + this.pixelStrokeWidth();
			return this.alignedPocBounds(actualLeft - offset, actualRight + offset);
		}
		shiftedX(x) {
			const centre = this.centres.find((c) => Math.abs(x / this.dpr - c) <= this.renderWidth / 2 + 1);
			return centre === void 0 ? x : x + (x / this.dpr < centre ? -this.gap / 2 : this.gap / 2) * this.dpr;
		}
		extendProfileLevel(x, side) {
			const edge = this.rc ? this.rc.plotWidth * this.dpr : Infinity;
			const endpoint = x + (side === "left" ? -1 : 1) * PROFILE_LEVEL_EXTENSION * this.dpr;
			return Math.max(0, Math.min(edge, endpoint));
		}
		contexts = /* @__PURE__ */ new WeakMap();
		constructor(options) {
			super({
				...options,
				showCandle: false
			});
			this.style = { ...options };
			this.statsHeight = options.statsRowHeight;
		}
		setCellOpacity(opacity) {
			this.opacity = Math.max(0, Math.min(1, opacity));
		}
		options() {
			return {
				...this.style,
				statsRowHeight: this.statsHeight,
				statsRows: [...this.style.statsRows],
				tableRows: [...this.style.tableRows]
			};
		}
		setOptions(options) {
			this.style = {
				...this.style,
				...options
			};
			this.renderWidth = -1;
			super.setOptions({
				...options,
				showCandle: false
			});
		}
		setBars(bars) {
			this.bars = bars;
			this.rowSize = bars[0]?.rowSize ?? 0;
			this.longest = 1;
			for (const bar of bars) for (const cell of bar.cells) for (const value of [
				cell.bidVol,
				cell.askVol,
				cell.bidVol + cell.askVol,
				cell.askVol - cell.bidVol
			]) this.longest = Math.max(this.longest, he(value / this.style.volumeDivisor).length);
			super.setBars(bars);
		}
		draw(ctx, rc) {
			const paintStarted = performance.now();
			this.fontEpoch++;
			this.dpr = rc.dpr;
			this.valueAreaPath = false;
			this.pendingCellRect = null;
			this.previousCellPaint = null;
			this.lastCellPaint = null;
			this.pocMarkerBounds.clear();
			const o = this.style, spacing = rc.timeScale.barSpacing;
			const geometry = footprintColumn(o, spacing);
			this.rc = rc;
			this.gap = geometry.gap;
			const rows = o.tableRows.length || (o.statsPosition === "bottom" ? o.statsRows.length : 0);
			const statsHeight = rows ? Math.min(o.statsRowHeight, Math.max(8, Math.floor(rc.plotHeight * .4 / rows))) : o.statsRowHeight;
			if (this.renderWidth !== geometry.cells || this.statsHeight !== statsHeight) {
				this.statsHeight = statsHeight;
				this.renderWidth = geometry.cells;
				this.configuringDraw = true;
				try {
					super.setOptions({
						cellWidth: geometry.cells,
						showCandle: false,
						statsRowHeight: statsHeight,
						statsRows: o.statsPosition === "bar" ? [] : o.statsRows
					});
				} finally {
					this.configuringDraw = false;
				}
			}
			this.centres = this.bars.flatMap((bar) => {
				const i = rc.dataLayer.timeToIndex(bar.time);
				return i === void 0 ? [] : [rc.timeScale.indexToX(i)];
			});
			const width = geometry.cells / (o.displayMode === "bidask" ? 2 : 1);
			const step = o.tickSize ?? this.rowSize, range = rc.priceScale.priceRange();
			const height = Math.abs(rc.priceScale.priceToY(range.min + step) - rc.priceScale.priceToY(range.min));
			this.cellHeightPx = height * this.dpr;
			const fittedFont = Math.max(9, Math.min(24, height * .75, (width - 4) / (this.longest * .6)));
			const minDeviceFont = Math.ceil(9 * this.dpr), maxDeviceFont = Math.floor(24 * this.dpr);
			this.cellFontPx = Math.min(maxDeviceFont, Math.max(minDeviceFont, Math.floor(fittedFont * this.dpr)));
			this.cellFont = this.cellFontPx / this.dpr;
			this.nativeCellFont = `${o.font * this.dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
			this.paintedCellFont = `600 ${this.cellFontPx}px ${FOOTPRINT_FONT_FAMILY}`;
			let proxy = this.contexts.get(ctx);
			if (!proxy) {
				const methods = /* @__PURE__ */ new Map();
				let assignedFont, assignedFontEpoch = -1;
				proxy = new Proxy(ctx, {
					set: (target, key, value) => {
						if (key === "strokeStyle") this.valueAreaPath = this.style.showValueArea && value === this.style.valueAreaColor;
						if (key === "font") {
							this.cellText = value === this.nativeCellFont;
							if (this.cellText) value = this.paintedCellFont;
							if (assignedFontEpoch === this.fontEpoch && value === assignedFont) return true;
							const accepted = Reflect.set(target, key, value, target);
							if (accepted) {
								assignedFont = value;
								assignedFontEpoch = this.fontEpoch;
							}
							return accepted;
						}
						return Reflect.set(target, key, value, target);
					},
					get: (target, key) => {
						if (key === "restore") {
							if (!methods.has(key)) methods.set(key, () => {
								assignedFontEpoch = -1;
								target.restore();
							});
							return methods.get(key);
						}
						if (key === "moveTo" || key === "lineTo" || key === "stroke") {
							if (!methods.has(key)) methods.set(key, (...args) => {
								if (this.valueAreaPath) {
									if (key === "stroke") {
										const dash = this.pixelStrokeWidth();
										target.save();
										target.setLineDash([dash * 3, dash * 2]);
										target.strokeStyle = this.levelGuideColor();
										target.globalAlpha = 1;
										target.lineWidth = dash * 2;
										try {
											return target.stroke.apply(target, args);
										} finally {
											target.restore();
										}
									}
									if (this.gap) args[0] = this.shiftedX(args[0]);
									args[0] = this.alignStroke(this.extendProfileLevel(args[0], key === "moveTo" ? "left" : "right"));
									args[1] = this.alignStroke(args[1]);
								}
								return target[key].apply(target, args);
							});
							return methods.get(key);
						}
						if (key === "roundRect" || key === "fillText" || key === "fillRect" || key === "strokeRect") {
							if (!methods.has(key)) methods.set(key, (...args) => {
								if (key === "fillRect" && this.cellText && this.style.cellStyle === "profile" && target.fillStyle === this.rc?.theme.background) return;
								const poc = key === "strokeRect" && Math.abs(args[2] / this.dpr - this.renderWidth) < .01;
								if (this.gap && (key === "roundRect" ? args[2] <= this.renderWidth * this.dpr / 2 : poc || this.cellText)) {
									const index = key === "fillText" ? 1 : 0;
									if (key === "strokeRect" && Math.abs(args[2] / this.dpr - this.renderWidth) < .01) {
										args[0] -= this.gap * this.dpr / 2;
										args[2] += this.gap * this.dpr;
									} else {
										const anchor = args[index] + (key === "fillText" ? 0 : args[2] / 2);
										args[index] += this.shiftedX(anchor) - anchor;
									}
								}
								if (key === "roundRect") {
									this.alignCellRect(args);
									this.pendingCellRect = this.isCellBackground([
										args[0],
										args[1],
										args[2],
										args[3]
									]) ? [
										args[0],
										args[1],
										args[2],
										args[3]
									] : null;
								}
								if (key === "fillRect" && this.cellText) this.rememberCellPaint([
									args[0],
									args[1],
									args[2],
									args[3]
								], target.fillStyle, target.globalAlpha);
								if (key === "fillText" && this.cellText) {
									args[1] = Math.round(args[1]);
									args[2] = Math.round(args[2]);
								}
								if (poc) {
									const rawLeft = args[0], rawRight = args[0] + args[2];
									const centreY = args[1] + args[3] / 2;
									const [left, right] = this.pocHorizontalBounds(rawLeft, rawRight, centreY);
									this.pocMarkerBounds.set(Math.round((rawLeft + rawRight) / 2), [left, right]);
									args[0] = left;
									args[2] = Math.max(0, right - args[0]);
									const top = this.alignStroke(args[1]), bottom = this.alignStroke(args[1] + args[3]);
									args[1] = top;
									args[3] = Math.max(1, bottom - top);
									const rightEdge = args[0] + args[2], bottomEdge = args[1] + args[3];
									const dash = this.pixelStrokeWidth();
									target.save();
									target.setLineDash([dash * 3, dash * 2]);
									target.strokeStyle = this.levelGuideColor();
									target.globalAlpha = 1;
									target.lineWidth = dash * 2;
									try {
										const marker = new Path2D();
										marker.moveTo(args[0], top);
										marker.lineTo(args[0], bottomEdge);
										marker.moveTo(rightEdge, top);
										marker.lineTo(rightEdge, bottomEdge);
										return target.stroke(marker);
									} finally {
										target.restore();
									}
								}
								if (key === "fillText" && this.cellText && typeof target.fillStyle === "string") {
									const textColor = target.fillStyle;
									const textAlpha = target.globalAlpha;
									const adjusted = readableTextColor(textColor, this.cellTextBackgrounds(args, target), textAlpha, !this.style.textColor);
									target.fillStyle = adjusted?.color ?? opaqueTextColor(textColor);
									if (adjusted) target.globalAlpha = adjusted.alpha;
									try {
										if (adjusted?.outline) {
											target.save();
											try {
												target.strokeStyle = adjusted.outline;
												target.lineWidth = this.pixelStrokeWidth();
												target.lineJoin = "round";
												target.setLineDash([]);
												target.shadowBlur = 0;
												target.shadowOffsetX = 0;
												target.shadowOffsetY = 0;
												target.shadowColor = "rgba(0,0,0,0)";
												if (typeof args[3] === "number") target.strokeText(String(args[0]), args[1], args[2], args[3]);
												else target.strokeText(String(args[0]), args[1], args[2]);
											} finally {
												target.restore();
											}
										}
										return target[key].apply(target, args);
									} finally {
										target.fillStyle = textColor;
										target.globalAlpha = textAlpha;
									}
								}
								return target[key].apply(target, args);
							});
							return methods.get(key);
						}
						if (key === "fill") {
							if (!methods.has(key)) methods.set(key, (...args) => {
								const alpha = target.globalAlpha;
								const cellBackground = this.pendingCellRect !== null;
								if (cellBackground) this.rememberCellPaint(this.pendingCellRect, target.fillStyle, alpha * this.opacity);
								this.pendingCellRect = null;
								if (cellBackground) target.globalAlpha = alpha * this.opacity;
								try {
									target.fill(...args);
								} finally {
									target.globalAlpha = alpha;
								}
							});
							return methods.get(key);
						}
						const value = Reflect.get(target, key, target);
						if (typeof value !== "function") return value;
						if (!methods.has(key)) methods.set(key, value.bind(target));
						return methods.get(key);
					}
				});
				this.contexts.set(ctx, proxy);
			}
			super.draw(proxy, rc);
			const visible = rc.timeScale.visibleRange(), priceRange = rc.priceScale.priceRange();
			this.paint.times = [];
			this.paint.cells = 0;
			for (const bar of this.bars) {
				const index = rc.dataLayer.timeToIndex(bar.time);
				if (index === void 0 || index < visible.from - .5 || index > visible.to + .5) continue;
				const cells = bar.cells.filter((cell) => cell.price + (bar.rowSize || this.rowSize) >= priceRange.min && cell.price <= priceRange.max).length;
				if (cells) {
					this.paint.times.push(bar.time);
					this.paint.cells += cells;
				}
			}
			if (o.statsPosition === "bar") this.drawBarTotals(ctx, rc);
			if (this.bars.length && o.showCandle) this.drawCandles(ctx, rc);
			this.paint.at = performance.now();
			this.paint.draws++;
			this.paint.ms = this.paint.at - paintStarted;
		}
		rememberCellPaint(rect, fillStyle, alpha) {
			if (typeof fillStyle !== "string") return;
			const fill = parseRgbColor(fillStyle), base = parseRgbColor(this.rc?.theme.background ?? "");
			if (!fill || !base) return;
			const opacity = Math.max(0, Math.min(1, alpha * fill.a));
			this.previousCellPaint = this.lastCellPaint;
			this.lastCellPaint = {
				x: rect[0],
				y: rect[1],
				width: rect[2],
				height: rect[3],
				background: compositeColor(fill, base, opacity)
			};
		}
		isCellBackground(rect) {
			const [x, y, width, height] = rect, rc = this.rc;
			const rows = this.style.tableRows.length || (this.style.statsPosition === "bottom" ? this.style.statsRows.length : 0);
			const contentHeight = rc ? Math.max(0, rc.plotHeight - rows * this.statsHeight) * this.dpr : 0;
			if (!rc || this.cellHeightPx <= 0 || Math.abs(height - this.cellHeightPx) > Math.max(2, this.dpr) || width <= 0 || width > this.renderWidth * this.dpr + 1 || y + height <= 0 || y >= contentHeight) return false;
			const halfBar = (this.renderWidth + this.gap) * this.dpr / 2 + 1;
			return this.centres.some((centre) => x >= centre * this.dpr - halfBar && x + width <= centre * this.dpr + halfBar);
		}
		cellTextBackgrounds(args, target) {
			const cell = this.lastCellPaint, themeBackground = parseRgbColor(this.rc?.theme.background ?? "");
			const backgrounds = themeBackground ? [themeBackground] : [];
			if (!cell) return backgrounds;
			const width = target.measureText(String(args[0])).width;
			const anchor = args[1];
			const left = target.textAlign === "center" ? anchor - width / 2 : target.textAlign === "right" || target.textAlign === "end" ? anchor - width : anchor;
			const right = left + width;
			const outlinePad = this.pixelStrokeWidth() / 2;
			const textTop = args[2] - this.cellFontPx / 2 - outlinePad, textBottom = args[2] + this.cellFontPx / 2 + outlinePad;
			if (!(right > cell.x && left < cell.x + cell.width && textBottom > cell.y && textTop < cell.y + cell.height)) return backgrounds;
			if (left - outlinePad >= cell.x && right + outlinePad <= cell.x + cell.width && textTop >= cell.y && textBottom <= cell.y + cell.height) return [cell.background];
			if (!backgrounds.some((background) => background.r === cell.background.r && background.g === cell.background.g && background.b === cell.background.b)) backgrounds.push(cell.background);
			return backgrounds;
		}
		/** Native per-bar totals use the complete gap to each neighbouring histogram. */
		drawBarTotals(ctx, rc) {
			const o = this.style, spacing = rc.timeScale.barSpacing;
			const { column, annotation } = footprintColumn(o, spacing);
			if (!annotation) return;
			const dpr = rc.dpr, physicalFont = Math.max(1, Math.round(9 * dpr));
			const markerOffset = o.showPoc && o.pocStyle === "outline" ? POC_MARKER_CELL_GAP + this.pixelStrokeWidth() / dpr : 0;
			const gap = Math.max(3, 4 - markerOffset);
			const footerRows = o.tableRows.length ? o.tableRows.length : 0;
			const contentHeight = Math.max(0, rc.plotHeight - footerRows * this.statsHeight);
			const background = parseRgbColor(rc.theme.background);
			const neutralColor = o.textColor ?? rc.theme.axisText;
			const stats = this.stats();
			const centres = this.bars.map((bar) => {
				const index = rc.dataLayer.timeToIndex(bar.time);
				return index === void 0 ? void 0 : rc.timeScale.indexToX(index);
			});
			const labels = [];
			const leftLabels = [];
			const rightLabels = [];
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, rc.plotWidth * dpr, contentHeight * dpr);
			ctx.clip();
			ctx.font = `${physicalFont}px ui-monospace, SFMono-Regular, Menlo, monospace`;
			ctx.textBaseline = "middle";
			ctx.globalAlpha = 1;
			for (let n = 0; n < this.bars.length; n++) {
				const bar = this.bars[n], totals = stats[n];
				const index = rc.dataLayer.timeToIndex(bar.time);
				if (index === void 0 || !totals || !bar.cells.length) continue;
				const centre = rc.timeScale.indexToX(index), y = Math.round(rc.priceScale.priceToY(totals.poc) * dpr);
				if (!Number.isFinite(y) || y < 0 || y > contentHeight * dpr) continue;
				const [leftMark, rightMark] = this.pocMarkerBounds.get(Math.round(centre * dpr)) ?? this.alignedPocBounds((centre - column / 2) * dpr, (centre + column / 2) * dpr);
				const previousCentre = centres[n - 1], nextCentre = centres[n + 1];
				const leftSlot = Math.max(0, previousCentre === void 0 ? 0 : previousCentre + column / 2);
				const rightSlot = Math.min(rc.plotWidth, nextCentre === void 0 ? rc.plotWidth : nextCentre - column / 2);
				const leftX = Math.round((leftMark / dpr - gap) * dpr), rightX = Math.round((rightMark / dpr + gap) * dpr);
				const leftAvailable = Math.max(0, leftMark / dpr - gap - leftSlot) * dpr;
				const rightAvailable = Math.max(0, rightSlot - rightMark / dpr - gap) * dpr;
				const volume = he(totals.volume / o.volumeDivisor);
				const delta = `${totals.delta >= 0 ? "+" : ""}${he(totals.delta / o.volumeDivisor)}`;
				const volumeWidth = ctx.measureText(volume).width, deltaWidth = ctx.measureText(delta).width;
				const deltaColor = totals.delta === 0 ? neutralColor : totals.delta > 0 ? o.buyTextColor ?? rc.theme.upColor : o.sellTextColor ?? rc.theme.downColor;
				if (volumeWidth <= leftAvailable) {
					const label = {
						side: "left",
						value: volume,
						x: leftX,
						y,
						width: volumeWidth,
						color: neutralColor,
						visible: true
					};
					labels.push(label);
					leftLabels[n] = label;
				}
				if (deltaWidth <= rightAvailable) {
					const label = {
						side: "right",
						value: delta,
						x: rightX,
						y,
						width: deltaWidth,
						color: deltaColor,
						visible: true
					};
					labels.push(label);
					rightLabels[n] = label;
				}
			}
			for (let n = 0; n + 1 < this.bars.length; n++) {
				const delta = rightLabels[n], volume = leftLabels[n + 1];
				if (!delta || !volume) continue;
				const horizontal = Math.max(delta.x, volume.x - volume.width) < Math.min(delta.x + delta.width, volume.x) - 1;
				const vertical = Math.abs(delta.y - volume.y) < physicalFont;
				if (!horizontal || !vertical) continue;
				if (delta.width <= volume.width) volume.visible = false;
				else delta.visible = false;
			}
			for (const label of labels) {
				if (!label.visible) continue;
				const readable = readableTextColor(label.color, background ? [background] : [], 1, true) ?? {
					color: opaqueTextColor(label.color),
					alpha: 1
				};
				ctx.textAlign = label.side === "left" ? "right" : "left";
				ctx.fillStyle = readable.color;
				ctx.globalAlpha = 1;
				if (readable.outline) {
					ctx.save();
					try {
						ctx.strokeStyle = readable.outline;
						ctx.lineWidth = this.pixelStrokeWidth();
						ctx.lineJoin = "round";
						ctx.setLineDash([]);
						ctx.shadowBlur = 0;
						ctx.shadowOffsetX = 0;
						ctx.shadowOffsetY = 0;
						ctx.shadowColor = "rgba(0,0,0,0)";
						ctx.strokeText(label.value, label.x, label.y);
					} finally {
						ctx.restore();
					}
				}
				ctx.fillText(label.value, label.x, label.y);
			}
			ctx.restore();
		}
		drawCandles(ctx, rc) {
			const o = this.style, dpr = rc.dpr;
			const rows = o.tableRows.length || (o.statsPosition === "bottom" ? o.statsRows.length : 0);
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, rc.plotWidth * dpr, Math.max(0, rc.plotHeight - rows * this.statsHeight) * dpr);
			ctx.clip();
			for (const bar of this.bars) {
				const index = rc.dataLayer.timeToIndex(bar.time);
				if (index === void 0 || bar.open === void 0 || bar.close === void 0 || bar.high === void 0 || bar.low === void 0) continue;
				const x = rc.timeScale.indexToX(index);
				if (x < 0 || x > rc.plotWidth) continue;
				const centre = this.gap ? x : x - footprintColumn(o, rc.timeScale.barSpacing).column / 2 - 6;
				const bodyWidth = Math.min(8, Math.max(2, this.gap ? this.gap * .4 : rc.timeScale.barSpacing * .06));
				const high = rc.priceScale.priceToY(bar.high), low = rc.priceScale.priceToY(bar.low);
				const open = rc.priceScale.priceToY(bar.open), close = rc.priceScale.priceToY(bar.close);
				ctx.fillStyle = bar.close >= bar.open ? o.buyColor ?? rc.theme.upColor : o.sellColor ?? rc.theme.downColor;
				const wickWidth = Math.max(1, Math.round(dpr));
				const wickLeft = Math.round((centre - .5) * dpr);
				const wickTop = Math.round(Math.min(high, low) * dpr), wickBottom = Math.round(Math.max(high, low) * dpr);
				const bodyLeft = Math.round((centre - bodyWidth / 2) * dpr), bodyRight = Math.round((centre + bodyWidth / 2) * dpr);
				const bodyTop = Math.round(Math.min(open, close) * dpr), bodyBottom = Math.round(Math.max(open, close) * dpr);
				ctx.fillRect(wickLeft, wickTop, wickWidth, Math.max(wickWidth, wickBottom - wickTop));
				ctx.fillRect(bodyLeft, bodyTop, Math.max(1, bodyRight - bodyLeft), Math.max(wickWidth, bodyBottom - bodyTop));
			}
			ctx.restore();
		}
		hoverAt(x, y, rc) {
			const context = rc ?? this.rc;
			if (!context || !this.gap) return super.hoverAt(x, y, rc);
			const rows = this.style.tableRows.length || (this.style.statsPosition === "bottom" ? this.style.statsRows.length : 0);
			if (y >= context.plotHeight - rows * this.statsHeight) return super.hoverAt(x, y, context);
			const centre = this.centres.find((c) => Math.abs(x - c) <= (this.renderWidth + this.gap) / 2);
			if (centre === void 0 || Math.abs(x - centre) < this.gap / 2) return null;
			return super.hoverAt(x + (x < centre ? this.gap / 2 : -this.gap / 2), y, context);
		}
	};
	function opaqueTextColor(color) {
		const rgba = /^rgba\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*[^)]+\)$/i.exec(color);
		return rgba ? `rgb(${rgba[1].trim()}, ${rgba[2].trim()}, ${rgba[3].trim()})` : color;
	}
	function parseRgbColor(color) {
		const key = color.trim();
		if (RGB_COLOR_CACHE.has(key)) return RGB_COLOR_CACHE.get(key) ?? null;
		const parsed = parseRgbColorUncached(key);
		RGB_COLOR_CACHE.set(key, parsed);
		if (RGB_COLOR_CACHE.size > 64) RGB_COLOR_CACHE.delete(RGB_COLOR_CACHE.keys().next().value);
		return parsed;
	}
	var RGB_COLOR_CACHE = /* @__PURE__ */ new Map();
	function parseRgbColorUncached(color) {
		const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color);
		if (hex) {
			const value = hex[1].length === 3 ? [...hex[1]].map((channel) => channel + channel).join("") : hex[1];
			return {
				r: parseInt(value.slice(0, 2), 16),
				g: parseInt(value.slice(2, 4), 16),
				b: parseInt(value.slice(4, 6), 16),
				a: 1
			};
		}
		const match = /^rgba?\(([^)]+)\)$/i.exec(color);
		if (!match) return null;
		const parts = match[1].trim().split(/[\s,/]+/);
		if (parts.length < 3) return null;
		const channel = (part) => {
			const value = Number.parseFloat(part);
			return Number.isFinite(value) ? Math.max(0, Math.min(255, part.endsWith("%") ? value * 2.55 : value)) : NaN;
		};
		const r = channel(parts[0]), g = channel(parts[1]), b = channel(parts[2]);
		const alphaValue = parts[3] === void 0 ? 1 : Number.parseFloat(parts[3]);
		if (![
			r,
			g,
			b,
			alphaValue
		].every(Number.isFinite)) return null;
		return {
			r,
			g,
			b,
			a: Math.max(0, Math.min(1, alphaValue))
		};
	}
	function compositeColor(foreground, background, alpha) {
		return {
			r: foreground.r * alpha + background.r * (1 - alpha),
			g: foreground.g * alpha + background.g * (1 - alpha),
			b: foreground.b * alpha + background.b * (1 - alpha),
			a: 1
		};
	}
	function relativeLuminance(color) {
		const linear = (value) => {
			const channel = value / 255;
			return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
		};
		return .2126 * linear(color.r) + .7152 * linear(color.g) + .0722 * linear(color.b);
	}
	function contrastRatio(first, second) {
		const a = relativeLuminance(first), b = relativeLuminance(second);
		return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
	}
	function readableTextColor(color, backgrounds, globalAlpha, forceOpaque) {
		const foreground = parseRgbColor(color);
		if (!foreground) return null;
		const opaque = {
			...foreground,
			a: 1
		};
		const effectiveAlpha = Math.max(0, Math.min(1, globalAlpha * (forceOpaque ? 1 : foreground.a)));
		if (backgrounds.map((background) => compositeColor(foreground, background, effectiveAlpha)).every((colorAtCell, index) => contrastRatio(colorAtCell, backgrounds[index]) >= 4.5)) return {
			color: forceOpaque ? `rgb(${Math.round(opaque.r)}, ${Math.round(opaque.g)}, ${Math.round(opaque.b)})` : color,
			alpha: globalAlpha
		};
		const black = {
			r: 0,
			g: 0,
			b: 0,
			a: 1
		}, white = {
			r: 255,
			g: 255,
			b: 255,
			a: 1
		};
		const minimumContrast = (foreground) => backgrounds.length ? Math.min(...backgrounds.map((background) => contrastRatio(foreground, background))) : 0;
		const whiteContrast = minimumContrast(white), blackContrast = minimumContrast(black);
		if (whiteContrast >= 4.5 || blackContrast >= 4.5) return whiteContrast >= blackContrast ? {
			color: "rgb(255, 255, 255)",
			alpha: 1
		} : {
			color: "rgb(0, 0, 0)",
			alpha: 1
		};
		return whiteContrast >= blackContrast ? {
			color: "rgb(255, 255, 255)",
			alpha: 1,
			outline: "rgb(0, 0, 0)"
		} : {
			color: "rgb(0, 0, 0)",
			alpha: 1,
			outline: "rgb(255, 255, 255)"
		};
	}
	//#endregion
	//#region src/chart/footprint-units.ts
	/** Display projection only; canonical volumes, execution OHLC and subscription identity stay in BTC. */
	function footprintForUnits(bar, units) {
		if (units === "btc") return bar;
		if (![
			bar.quoteDelta,
			bar.minQuoteDelta,
			bar.maxQuoteDelta
		].every((value) => typeof value === "number" && Number.isFinite(value)) || bar.cells.some((cell) => typeof cell.bidNotional !== "number" || !Number.isFinite(cell.bidNotional) || cell.bidNotional < 0 || typeof cell.askNotional !== "number" || !Number.isFinite(cell.askNotional) || cell.askNotional < 0)) return null;
		return {
			...bar,
			cells: bar.cells.map((cell) => ({
				...cell,
				bidVol: cell.bidNotional,
				askVol: cell.askNotional
			})),
			delta: bar.quoteDelta,
			minDelta: bar.minQuoteDelta,
			maxDelta: bar.maxQuoteDelta
		};
	}
	//#endregion
	exports.Candidate = TerminalFootprint;
	exports.Control = TerminalFootprint$1;
	exports.DEFAULT_FOOTPRINT_OPTIONS = ce;
	exports.footprintForUnits = footprintForUnits;
	return exports;
})({});

//# sourceMappingURL=comparison.js.map