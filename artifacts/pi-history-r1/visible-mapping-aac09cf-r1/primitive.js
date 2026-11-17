var ProjectionBench = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region src/feed/order-wall-rank.ts
	var better = (a, b) => a.usd > b.usd || a.usd === b.usd && a.price < b.price;
	function priority(price) {
		let h = 2166136261;
		for (const c of String(price)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
		return h >>> 0;
	}
	var higher = (a, b) => a.priority < b.priority || a.priority === b.priority && a.price < b.price;
	function refresh(n) {
		n.sumUsd = (n.left?.sumUsd ?? 0) + n.usd + (n.right?.sumUsd ?? 0);
		n.sumQuantity = (n.left?.sumQuantity ?? 0) + n.quantity + (n.right?.sumQuantity ?? 0);
		n.low = n.left?.low ?? n.price;
		n.high = n.right?.high ?? n.price;
		n.best = n;
		if (n.left && better(n.left.best, n.best)) n.best = n.left.best;
		if (n.right && better(n.right.best, n.best)) n.best = n.right.best;
		return n;
	}
	function merge(a, b) {
		if (!a) return b;
		if (!b) return a;
		if (higher(a, b)) {
			a.right = merge(a.right, b);
			return refresh(a);
		}
		b.left = merge(a, b.left);
		return refresh(b);
	}
	function set(n, price, usd, quantity) {
		if (!n) return usd > 0 ? {
			price,
			usd,
			quantity,
			sumUsd: usd,
			sumQuantity: quantity,
			priority: priority(price),
			low: price,
			high: price,
			best: {
				price,
				usd
			}
		} : void 0;
		if (price === n.price) {
			if (usd <= 0) return merge(n.left, n.right);
			n.usd = usd;
			n.quantity = quantity;
			return refresh(n);
		}
		if (price < n.price) {
			n.left = set(n.left, price, usd, quantity);
			if (n.left && higher(n.left, n)) {
				const a = n.left;
				n.left = a.right;
				a.right = refresh(n);
				return refresh(a);
			}
		} else {
			n.right = set(n.right, price, usd, quantity);
			if (n.right && higher(n.right, n)) {
				const a = n.right;
				n.right = a.left;
				a.left = refresh(n);
				return refresh(a);
			}
		}
		return refresh(n);
	}
	var OrderWallRankIndex = class {
		root;
		metrics = {
			updates: 0,
			queries: 0,
			visited: 0
		};
		set(price, usd, quantity = 0) {
			this.root = set(this.root, price, usd, quantity);
			this.metrics.updates++;
		}
		clear() {
			this.root = void 0;
		}
		/** Deterministic Cartesian-tree grouping gives the same Float64 sums after
		* checkpoint reordering; it also avoids sorting/summing every bucket member. */
		sum(low, high, quantity = false) {
			const visit = (n) => {
				if (!n || n.high < low || n.low >= high) return 0;
				if (n.low >= low && n.high < high) return quantity ? n.sumQuantity : n.sumUsd;
				return visit(n.left) + (n.price >= low && n.price < high ? quantity ? n.quantity : n.usd : 0) + visit(n.right);
			};
			return visit(this.root);
		}
		/** Price-ordered membership projection, bounded by count; no strength sort. */
		levels(count, descending = false) {
			const result = [];
			const visit = (n) => {
				if (!n || result.length >= count) return;
				visit(descending ? n.right : n.left);
				if (result.length < count) result.push([n.price, n.quantity]);
				visit(descending ? n.left : n.right);
			};
			visit(this.root);
			return result;
		}
		get min() {
			return this.root?.low;
		}
		get max() {
			return this.root?.high;
		}
		top(count, low, high, minimum = 0) {
			const result = [];
			this.metrics.queries++;
			const visit = (n) => {
				if (!n || n.high < low || n.low > high || n.best.usd < minimum || result.length === count && !better(n.best, result[count - 1])) return;
				this.metrics.visited++;
				if (n.price >= low && n.price <= high && n.usd >= minimum) {
					const item = {
						price: n.price,
						usd: n.usd
					};
					let i = 0;
					while (i < result.length && !better(item, result[i])) i++;
					result.splice(i, 0, item);
					if (result.length > count) result.pop();
				}
				const a = n.left, b = n.right;
				if (a && b && better(b.best, a.best)) {
					visit(b);
					visit(a);
				} else {
					visit(a);
					visit(b);
				}
			};
			if (count > 0 && low <= high) visit(this.root);
			return result;
		}
	};
	//#endregion
	//#region src/shared/order-walls-projection.ts
	/** Portable exact archive projection. This file is shared byte-for-byte with
	* iqterminal-server; it has no DOM, transport or serving dependencies. */
	var ORDER_WALL_ARCHIVE_MAX_SEGMENTS = 1e5;
	Object.freeze({
		enabled: false,
		mode: "top-levels",
		topLevels: 8,
		searchRangePercent: 10,
		minimumNotionalEnabled: false,
		minimumNotionalUsd: 1e5,
		highContrast: true,
		visibleRangeOnly: true,
		strengthThickness: true,
		historyEpisodes: 2e3,
		showHistory: true,
		showPriceLines: false,
		method: "relative",
		thresholdUsd: 5e5,
		relativeFloorUsd: 25e4,
		relativePercentile: 95,
		exitRatio: .85,
		minDurationMs: 0,
		aggregation: "native",
		colorMode: "heat",
		opacity: .85,
		thicknessPx: 3
	});
	function orderWallValuePointAt(segment, at) {
		if (!Number.isFinite(at) || at < segment.start || segment.end !== null && at > segment.end) return null;
		const runs = segment.valueRuns;
		if (!runs?.length || segment.valueRunsTruncated && at < runs[0].at) return null;
		let low = 0, high = runs.length;
		while (low < high) {
			const mid = low + high >>> 1;
			if (runs[mid].at <= at) low = mid + 1;
			else high = mid;
		}
		return low === 0 ? null : runs[low - 1];
	}
	//#endregion
	//#region ../../../../tmp/iq-wall-math-onKb2s/baseline.ts
	var TOP_HEAT$1 = {
		bid: [
			"#33778c",
			"#45bcd0",
			"#f1cb59",
			"#ff884d"
		],
		ask: [
			"#666da5",
			"#8b99eb",
			"#e9c15b",
			"#ff8766"
		]
	};
	var TOP_SIDE$1 = {
		bid: [
			"#28644b",
			"#3d9970",
			"#66d39a",
			"#b6f1aa"
		],
		ask: [
			"#7b3f4b",
			"#bf6273",
			"#ed9a9e",
			"#ffd0b0"
		]
	};
	/** The chart data layer preserves sub-candle event times as fractional logical indices. */
	function wallTimestampToLogical$1(timeMs, timeToIndexFloat) {
		if (!Number.isFinite(timeMs)) return null;
		const logical = timeToIndexFloat(timeMs / 1e3);
		return Number.isFinite(logical) ? logical : null;
	}
	var OrderWallsPrimitive = class {
		cachePaintPaths;
		host;
		settings;
		intervalMs;
		status = { state: "loading" };
		segments = /* @__PURE__ */ new Map();
		openIds = /* @__PURE__ */ new Set();
		drawable = /* @__PURE__ */ new Map();
		drawableKeys = /* @__PURE__ */ new Map();
		version = 0;
		transformKey = "";
		dirty = /* @__PURE__ */ new Set();
		tailDirty = /* @__PURE__ */ new Map();
		closedDirectOrder = /* @__PURE__ */ new Map();
		closedArchiveOrder = /* @__PURE__ */ new Map();
		archiveEpisodeHistoryLimited = false;
		sizes = /* @__PURE__ */ new Map();
		reference = {
			min: 0,
			max: 0
		};
		referenceDirty = true;
		referenceIds = /* @__PURE__ */ new Set();
		referenceExtents = /* @__PURE__ */ new Map();
		referenceCounts = /* @__PURE__ */ new Map();
		referenceIndex = new OrderWallRankIndex();
		timeAtX;
		paintInvalid = true;
		paintKey = "";
		paintPaths;
		paintCounts = {
			historical: 0,
			current: 0
		};
		inputRevision = 0;
		paintedRevision = -1;
		paintedViewport;
		stats = {
			draws: 0,
			rebuilds: 0,
			patchProjects: 0,
			segments: 0,
			visible: 0,
			visibleHistorical: 0,
			visibleCurrent: 0,
			bytes: 0,
			renderMs: 0,
			maxRenderMs: 0,
			strokes: 0,
			lastProjectMs: 0,
			lastReferenceMs: 0,
			lastPaintMs: 0,
			referenceRebuilds: 0,
			referenceSegments: 0,
			referenceValueScans: 0,
			paintCacheHits: 0,
			paintCacheBuilds: 0,
			paintStyleVisits: 0,
			settingsNoops: 0
		};
		durations = [];
		constructor(settings, intervalMs, cachePaintPaths = true) {
			this.cachePaintPaths = cachePaintPaths;
			this.settings = { ...settings };
			this.intervalMs = intervalMs;
		}
		zOrder() {
			return "normal";
		}
		autoscaleInfo() {
			return null;
		}
		attached(host) {
			this.host = host;
		}
		detached() {
			this.clearEmptyProjection();
			this.openIds.clear();
			this.closedDirectOrder.clear();
			this.closedArchiveOrder.clear();
			this.sizes.clear();
			this.host = void 0;
			this.segments.clear();
			this.timeAtX = void 0;
			this.stats.bytes = 0;
		}
		setSettings(settings) {
			const keys = Object.keys(settings);
			if (keys.length === Object.keys(this.settings).length && keys.every((key) => Object.is(settings[key], this.settings[key]))) {
				this.stats.settingsNoops++;
				return;
			}
			this.inputRevision++;
			this.settings = { ...settings };
			this.trimHistory();
			this.referenceDirty = true;
			this.version++;
			this.host?.requestUpdate();
		}
		setInterval(intervalMs) {
			if (this.intervalMs !== intervalMs) {
				this.inputRevision++;
				this.intervalMs = intervalMs;
				this.transformKey = "";
				this.host?.requestUpdate();
			}
		}
		setStatus(status) {
			this.inputRevision++;
			const prior = this.status;
			this.status = this.effectiveStatus(status);
			this.advanceOpenTails(prior);
			this.host?.requestUpdate();
		}
		setSnapshot(segments, status) {
			this.inputRevision++;
			this.status = { ...status };
			this.archiveEpisodeHistoryLimited = status.episodeHistoryLimited === true;
			this.clearEmptyProjection();
			this.openIds.clear();
			this.closedDirectOrder.clear();
			this.closedArchiveOrder.clear();
			this.sizes.clear();
			this.segments.clear();
			for (const segment of segments) if (validSegment$1(segment) && !this.beforeRetention(segment)) {
				this.segments.set(segment.id, segment);
				if (segment.end === null) this.openIds.add(segment.id);
			}
			for (const segment of [...this.segments.values()].filter((s) => s.end !== null).sort((a, b) => a.end - b.end)) this.rememberClosed(segment);
			this.trimHistory();
			this.status = this.effectiveStatus(status);
			this.dirty = new Set(this.segments.keys());
			this.version++;
			this.transformKey = "";
			this.measureBytes();
			this.host?.requestUpdate();
		}
		patch(patches, status) {
			this.inputRevision++;
			const prior = this.status;
			this.status = { ...status };
			for (const patch of patches) {
				if (!patch.segment || !validSegment$1(patch.segment) || this.beforeRetention(patch.segment)) {
					this.segments.delete(patch.id);
					this.openIds.delete(patch.id);
					this.removeProjection(patch.id);
					this.closedDirectOrder.delete(patch.id);
					this.closedArchiveOrder.delete(patch.id);
					continue;
				}
				const previous = this.segments.get(patch.id), next = patch.segment;
				this.segments.set(patch.id, next);
				if (next.end === null) this.openIds.add(patch.id);
				else this.openIds.delete(patch.id);
				const shifted = Boolean(previous && (previous.valueRunsTruncated !== next.valueRunsTruncated || previous.valueRuns[0] && next.valueRuns[0] && previous.valueRuns[0].at !== next.valueRuns[0].at));
				if (!previous || patch.replaceValueRuns === true || shifted || previous.price !== next.price || previous.start !== next.start) {
					this.dirty.add(patch.id);
					this.tailDirty.delete(patch.id);
				} else this.markTail(patch.id, Math.max(0, next.valueRuns.length - (patch.valuePoints?.length ?? 0) - 1));
			}
			for (const patch of patches) {
				const next = this.segments.get(patch.id);
				if (next?.end !== null && next) this.rememberClosed(next);
				else {
					this.closedDirectOrder.delete(patch.id);
					this.closedArchiveOrder.delete(patch.id);
				}
				this.measureOne(patch.id);
				this.markReference(patch.id);
			}
			this.trimHistory();
			this.status = this.effectiveStatus(status);
			this.advanceOpenTails(prior);
			if (!this.segments.size) this.clearEmptyProjection();
			this.host?.requestUpdate();
		}
		removeProjection(id) {
			this.removeDrawables(id);
			this.dirty.delete(id);
			this.tailDirty.delete(id);
			this.referenceIds.delete(id);
			const extent = this.referenceExtents.get(id);
			if (extent) {
				this.countReference(extent.min, -1);
				this.countReference(extent.max, -1);
				this.referenceExtents.delete(id);
			}
		}
		clearEmptyProjection() {
			this.paintedViewport = void 0;
			this.paintPaths = void 0;
			this.paintInvalid = true;
			this.paintKey = "";
			this.paintCounts = {
				historical: 0,
				current: 0
			};
			this.drawable.clear();
			this.drawableKeys.clear();
			this.dirty.clear();
			this.tailDirty.clear();
			this.clearReference();
			this.referenceDirty = true;
			this.stats.referenceSegments = 0;
			this.stats.referenceValueScans = 0;
			this.stats.segments = 0;
			this.stats.visible = 0;
			this.stats.visibleHistorical = 0;
			this.stats.visibleCurrent = 0;
		}
		markReference(id) {
			if (this.referenceDirty) {
				this.referenceIds.clear();
				return;
			}
			if (this.segments.has(id) || this.referenceExtents.has(id)) this.referenceIds.add(id);
			else this.referenceIds.delete(id);
		}
		clearReference() {
			this.reference = {
				min: 0,
				max: 0
			};
			this.referenceIds.clear();
			this.referenceExtents.clear();
			this.referenceCounts.clear();
			this.referenceIndex.clear();
		}
		countReference(value, delta) {
			const count = (this.referenceCounts.get(value) ?? 0) + delta;
			if (count > 0) this.referenceCounts.set(value, count);
			else this.referenceCounts.delete(value);
			this.referenceIndex.set(value, Math.max(0, count));
		}
		updateReference(id) {
			const previous = this.referenceExtents.get(id);
			this.stats.referenceSegments++;
			let min = Infinity, max = 0;
			const accept = (value) => {
				this.stats.referenceValueScans++;
				if (value !== null && value > 0) {
					min = Math.min(min, value);
					max = Math.max(max, value);
				}
			};
			if (this.settings.visibleRangeOnly) for (const key of this.drawableKeys.get(id) ?? []) {
				const line = this.drawable.get(key);
				if (line) accept(line.usd);
			}
			else {
				const segment = this.segments.get(id);
				if (segment && (this.settings.showHistory || segment.end === null)) for (const run of segment.valueRuns) accept(run.usd);
			}
			if (previous && previous.min === min && previous.max === max) return;
			if (previous) {
				this.countReference(previous.min, -1);
				this.countReference(previous.max, -1);
				this.referenceExtents.delete(id);
			}
			if (max > 0) {
				this.referenceExtents.set(id, {
					min,
					max
				});
				this.countReference(min, 1);
				this.countReference(max, 1);
			}
		}
		rememberClosed(segment) {
			if (isArchiveSegment$1(segment)) this.closedArchiveOrder.set(segment.id, true);
			else this.closedDirectOrder.set(segment.id, true);
		}
		trimHistory() {
			while (this.closedDirectOrder.size > this.settings.historyEpisodes) {
				const id = this.closedDirectOrder.keys().next().value;
				this.closedDirectOrder.delete(id);
				this.segments.delete(id);
				this.removeProjection(id);
				this.measureOne(id);
			}
			while (this.closedArchiveOrder.size > ORDER_WALL_ARCHIVE_MAX_SEGMENTS) {
				const id = this.closedArchiveOrder.keys().next().value;
				this.closedArchiveOrder.delete(id);
				this.segments.delete(id);
				this.removeProjection(id);
				this.measureOne(id);
				this.archiveEpisodeHistoryLimited = true;
			}
		}
		effectiveStatus(status) {
			return this.archiveEpisodeHistoryLimited ? {
				...status,
				episodeHistoryLimited: true,
				...status.coverage ? { coverage: {
					...status.coverage,
					complete: false,
					partial: true
				} } : {}
			} : status;
		}
		beforeRetention(segment) {
			return this.status.retentionStart !== void 0 && (segment.end ?? this.status.lastConfirmedAt ?? segment.start) <= this.status.retentionStart;
		}
		width() {
			return this.settings.aggregation === "native" ? this.status.tickSize ?? .1 : this.settings.aggregation === "auto" ? this.status.resolvedPriceWidth ?? this.status.tickSize ?? .1 : this.settings.aggregation;
		}
		archivePaintThrough(status) {
			const a = status.archive?.loadedThrough, b = status.archive?.presentationThrough;
			return a === void 0 ? b : b === void 0 ? a : Math.max(a, b);
		}
		advanceOpenTails(prior) {
			const current = prior.lastConfirmedAt !== this.status.lastConfirmedAt, archive = this.archivePaintThrough(prior) !== this.archivePaintThrough(this.status);
			if (!current && !archive) return;
			for (const id of this.openIds) {
				const segment = this.segments.get(id);
				if (segment && (segment.archiveEntryId && !segment.currentSelection ? archive : current)) this.markTail(id, Math.max(0, segment.valueRuns.length - 1));
			}
		}
		markTail(id, index) {
			if (this.dirty.has(id)) return;
			this.tailDirty.set(id, Math.min(index, this.tailDirty.get(id) ?? index));
		}
		draw(ctx, rc) {
			if (!this.settings.enabled || !this.segments.size) return;
			const started = performance.now(), range = rc.timeScale.visibleRange(), prices = rc.priceScale.priceRange(), dpr = rc.dpr;
			this.timeAtX = (x) => rc.dataLayer.indexToTimeFloat(rc.timeScale.xToIndex(x)) * 1e3;
			const key = [
				this.version,
				this.intervalMs,
				range.from,
				range.to,
				prices.min,
				prices.max,
				rc.plotWidth,
				rc.plotHeight,
				dpr,
				rc.dataLayer.length,
				rc.dataLayer.indexToTime(0),
				rc.dataLayer.indexToTime(rc.dataLayer.baseIndex),
				this.width()
			].join(":");
			if (key !== this.transformKey) {
				if (this.settings.visibleRangeOnly) this.referenceDirty = true;
				this.drawable.clear();
				this.drawableKeys.clear();
				this.tailDirty.clear();
				this.dirty = new Set(this.segments.keys());
				this.transformKey = key;
				this.stats.rebuilds++;
			}
			const projectionStarted = performance.now();
			if (this.dirty.size) {
				for (const id of this.dirty) {
					if (this.settings.visibleRangeOnly) this.markReference(id);
					this.removeDrawables(id);
					const segment = this.segments.get(id);
					if (segment) this.projectAll(segment, rc);
					this.stats.patchProjects++;
				}
				this.dirty.clear();
			}
			if (this.tailDirty.size) {
				for (const [id, index] of this.tailDirty) {
					if (this.settings.visibleRangeOnly) this.markReference(id);
					const segment = this.segments.get(id);
					if (segment) this.projectTail(segment, index, rc);
					this.stats.patchProjects++;
				}
				this.tailDirty.clear();
			}
			this.stats.lastProjectMs = performance.now() - projectionStarted;
			const referenceStarted = performance.now();
			this.stats.referenceSegments = 0;
			this.stats.referenceValueScans = 0;
			if (this.referenceDirty) {
				this.clearReference();
				this.stats.referenceRebuilds++;
				for (const id of this.settings.visibleRangeOnly ? this.drawableKeys.keys() : this.segments.keys()) this.updateReference(id);
				this.referenceDirty = false;
			} else for (const id of this.referenceIds) this.updateReference(id);
			this.referenceIds.clear();
			const referenceMin = this.referenceIndex.min;
			this.reference = {
				min: referenceMin !== void 0 && Number.isFinite(referenceMin) ? referenceMin : 0,
				max: this.referenceIndex.max ?? 0
			};
			this.stats.lastReferenceMs = performance.now() - referenceStarted;
			const paintStarted = performance.now();
			this.stats.strokes = 0;
			this.stats.visibleHistorical = 0;
			this.stats.visibleCurrent = 0;
			this.stats.draws++;
			this.stats.segments = this.segments.size;
			this.stats.visible = this.drawable.size;
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, rc.plotWidth * dpr, rc.plotHeight * dpr);
			ctx.clip();
			ctx.globalAlpha = this.settings.opacity;
			ctx.lineWidth = this.settings.thicknessPx * dpr;
			ctx.lineCap = "butt";
			ctx.setLineDash([]);
			const paintKey = key + ":" + this.reference.min + ":" + this.reference.max;
			const cacheable = this.cachePaintPaths && typeof Path2D !== "undefined";
			if (cacheable && !this.paintInvalid && this.paintKey === paintKey && this.paintPaths) {
				for (const entry of this.paintPaths) {
					ctx.strokeStyle = entry.color;
					ctx.lineWidth = entry.thickness * dpr;
					ctx.stroke(entry.path);
					this.stats.strokes++;
				}
				this.stats.visibleHistorical = this.paintCounts.historical;
				this.stats.visibleCurrent = this.paintCounts.current;
				this.stats.paintCacheHits++;
			} else {
				const compiled = [];
				const stroke = (color, thickness, lines) => {
					ctx.strokeStyle = color;
					ctx.lineWidth = thickness * dpr;
					if (cacheable) {
						const path = new Path2D();
						for (const [x, right, y] of lines) {
							path.moveTo(x * dpr, y * dpr);
							path.lineTo(right * dpr, y * dpr);
						}
						ctx.stroke(path);
						compiled.push({
							color,
							thickness,
							path
						});
					} else {
						ctx.beginPath();
						for (const [x, right, y] of lines) {
							ctx.moveTo(x * dpr, y * dpr);
							ctx.lineTo(right * dpr, y * dpr);
						}
						ctx.stroke();
					}
					this.stats.strokes++;
				};
				let group;
				const paths = /* @__PURE__ */ new Map();
				const strokeGroup = () => {
					if (!group) return;
					if (group.top) {
						const key = `${group.color}:${group.thickness}`, path = paths.get(key) ?? {
							color: group.color,
							thickness: group.thickness,
							lines: []
						};
						path.lines.push([
							group.x,
							group.right,
							group.y
						]);
						paths.set(key, path);
					} else stroke(group.color, group.thickness, [[
						group.x,
						group.right,
						group.y
					]]);
					group = void 0;
				};
				for (const line of this.drawable.values()) {
					this.stats.paintStyleVisits++;
					if (line.segment.currentSelection) this.stats.visibleCurrent++;
					else if (line.segment.archiveEntryId) this.stats.visibleHistorical++;
					const style = this.lineStyle(line), color = style.color, right = Math.max(line.x + (line.segment.detectionMode === "top-levels" ? 1 / dpr : 1), line.right);
					if (group && group.segmentId === line.segment.id && group.epoch === line.segment.epoch && group.side === line.segment.side && group.color === color && group.thickness === style.thickness && group.to === line.from && group.low === line.low && group.high === line.high && group.y === line.y && line.x <= group.right) {
						group.to = line.to;
						group.right = Math.max(group.right, right);
						continue;
					}
					strokeGroup();
					group = {
						segmentId: line.segment.id,
						epoch: line.segment.epoch,
						side: line.segment.side,
						color,
						thickness: style.thickness,
						top: line.segment.detectionMode === "top-levels",
						from: line.from,
						to: line.to,
						x: line.x,
						right,
						y: line.y,
						low: line.low,
						high: line.high
					};
				}
				strokeGroup();
				for (const path of paths.values()) stroke(path.color, path.thickness, path.lines);
				this.paintPaths = cacheable ? compiled : void 0;
				this.paintKey = paintKey;
				this.paintInvalid = false;
				this.paintCounts = {
					historical: this.stats.visibleHistorical,
					current: this.stats.visibleCurrent
				};
				if (cacheable) this.stats.paintCacheBuilds++;
			}
			if (this.settings.showPriceLines) this.drawPriceLines(ctx, rc);
			ctx.restore();
			this.paintedRevision = this.inputRevision;
			this.paintedViewport = {
				fromMs: rc.dataLayer.indexToTimeFloat(range.from) * 1e3,
				toMs: rc.dataLayer.indexToTimeFloat(range.to) * 1e3,
				minPrice: prices.min,
				maxPrice: prices.max,
				plotWidth: rc.plotWidth,
				plotHeight: rc.plotHeight
			};
			this.stats.lastPaintMs = performance.now() - paintStarted;
			const elapsed = performance.now() - started;
			this.durations.push(elapsed);
			if (this.durations.length > 512) this.durations.shift();
			this.stats.renderMs += elapsed;
			this.stats.maxRenderMs = Math.max(this.stats.maxRenderMs, elapsed);
		}
		/** Presentation-only guides: never extend the recorded wall timeline itself. */
		drawPriceLines(ctx, rc) {
			const active = /* @__PURE__ */ new Map();
			for (const id of this.openIds) for (const key of this.drawableKeys.get(id) ?? []) {
				const line = this.drawable.get(key);
				if (!line) continue;
				const previous = active.get(id);
				if (!previous || line.from > previous.from) active.set(id, line);
			}
			const dpr = rc.dpr, occupied = [];
			ctx.font = `${10 * dpr}px ui-monospace, monospace`;
			ctx.textBaseline = "middle";
			ctx.textAlign = "right";
			const lines = [...active.values()].map((line) => ({
				line,
				segment: this.segments.get(line.segment.id)
			})).sort((a, b) => (b.segment.valueRuns.at(-1)?.usd ?? 0) - (a.segment.valueRuns.at(-1)?.usd ?? 0));
			for (const { line, segment } of lines) {
				const value = orderWallValuePointAt(segment, Math.min(line.to, this.segmentTo(segment)));
				if (!value || !Number.isFinite(value.usd) || line.y < 8 || line.y > rc.plotHeight - 8) continue;
				const color = this.lineStyle({
					...line,
					usd: value.usd,
					percentile: value.percentile
				}).color;
				ctx.strokeStyle = color;
				ctx.globalAlpha = this.settings.opacity * .28;
				ctx.lineWidth = dpr;
				ctx.setLineDash([2 * dpr, 4 * dpr]);
				if (line.segment.detectionMode !== "top-levels") {
					ctx.beginPath();
					ctx.moveTo(0, line.y * dpr);
					ctx.lineTo(rc.plotWidth * dpr, line.y * dpr);
					ctx.stroke();
				}
				if (occupied.some((y) => Math.abs(y - line.y) < 15)) continue;
				const price = (this.settings.aggregation === "native" ? line.low : (line.low + line.high) / 2).toLocaleString("en-US", { maximumFractionDigits: 8 });
				const size = value.usd.toLocaleString("en-US", {
					notation: "compact",
					maximumFractionDigits: 1
				});
				const text = `${this.status.state !== "live" ? "~" : ""}${line.segment.side === "bid" ? "B" : "A"} ${price} · $${size}`;
				const width = ctx.measureText(text).width + 10 * dpr;
				if (width > rc.plotWidth * dpr - 8 * dpr) continue;
				occupied.push(line.y);
				ctx.globalAlpha = .94;
				ctx.fillStyle = rc.theme.background;
				ctx.fillRect(rc.plotWidth * dpr - width - 4 * dpr, (line.y - 7) * dpr, width, 14 * dpr);
				ctx.globalAlpha = this.settings.opacity * .45;
				ctx.strokeStyle = color;
				ctx.setLineDash([]);
				ctx.strokeRect(rc.plotWidth * dpr - width - 4 * dpr, (line.y - 7) * dpr, width, 14 * dpr);
				ctx.globalAlpha = this.settings.opacity;
				ctx.fillStyle = rc.theme.axisText;
				ctx.fillText(text, (rc.plotWidth - 9) * dpr, line.y * dpr);
			}
		}
		lineStyle(line) {
			if (line.segment.detectionMode !== "top-levels") return {
				color: wallColor$1(line.percentile, this.settings.colorMode, line.segment.side),
				thickness: this.settings.thicknessPx
			};
			if (line.usd === null) return {
				color: "#6b6b6b",
				thickness: 1
			};
			const { min, max } = this.reference, v = line.usd ?? min;
			const strength = max <= 0 ? 0 : this.settings.highContrast ? max === min ? .5 : Math.max(0, Math.min(1, (v - min) / (max - min))) : Math.max(0, Math.min(1, v / max));
			const tier = strength >= .85 ? 3 : strength >= .55 ? 2 : strength >= .25 ? 1 : 0;
			const heat = TOP_HEAT$1[line.segment.side], side = TOP_SIDE$1[line.segment.side];
			return {
				color: (this.settings.colorMode === "heat" ? heat : side)[tier],
				thickness: this.settings.strengthThickness ? 1 + (this.settings.thicknessPx - 1) * tier / 3 : this.settings.thicknessPx
			};
		}
		projectAll(segment, rc) {
			if (segment.detectionMode === "top-levels" && segment.valueRunsTruncated && segment.valueRuns.length > 0 && segment.valueRuns[0].at > segment.start) {
				const line = this.project(segment, -1, segment.start, segment.valueRuns[0].at, null, rc);
				if (line) {
					this.paintInvalid = true;
					this.drawable.set(line.key, line);
					this.drawableKeys.set(segment.id, [line.key]);
				}
			}
			if (segment.valueRuns.length) {
				const range = rc.timeScale.visibleRange();
				const visibleFrom = rc.dataLayer.indexToTimeFloat(range.from) * 1e3, visibleTo = rc.dataLayer.indexToTimeFloat(range.to) * 1e3;
				const first = Math.max(0, lowerBoundRun$1(segment.valueRuns, visibleFrom) - 1);
				const afterLast = Math.min(segment.valueRuns.length, Math.max(first + 1, upperBoundRun$1(segment.valueRuns, visibleTo)));
				for (let index = first; index < afterLast; index++) this.projectIndex(segment, index, rc);
				return;
			}
			const to = this.segmentTo(segment);
			const line = this.project(segment, 0, segment.start, to, null, rc);
			if (line) {
				this.paintInvalid = true;
				this.drawable.set(line.key, line);
				this.drawableKeys.set(segment.id, [line.key]);
			}
		}
		projectTail(segment, fromIndex, rc) {
			if (!segment.valueRuns.length) {
				this.removeDrawables(segment.id);
				this.projectAll(segment, rc);
				return;
			}
			const keys = this.drawableKeys.get(segment.id) ?? [];
			for (const key of keys) {
				const drawable = this.drawable.get(key);
				if (drawable && drawable.runIndex >= fromIndex) {
					this.paintInvalid = true;
					this.drawable.delete(key);
				}
			}
			this.drawableKeys.set(segment.id, keys.filter((key) => this.drawable.has(key)));
			for (let i = fromIndex; i < segment.valueRuns.length; i++) this.projectIndex(segment, i, rc);
		}
		removeDrawables(id) {
			const keys = this.drawableKeys.get(id) ?? [];
			if (keys.length) this.paintInvalid = true;
			for (const key of keys) this.drawable.delete(key);
			this.drawableKeys.delete(id);
		}
		projectIndex(segment, index, rc) {
			const value = segment.valueRuns[index];
			if (!value) return;
			const next = segment.valueRuns[index + 1], from = value.at, to = Math.min(next?.at ?? this.segmentTo(segment), this.segmentTo(segment));
			const line = this.project(segment, index, from, to, value.percentile, rc);
			if (!line) return;
			this.paintInvalid = true;
			this.drawable.set(line.key, line);
			const keys = this.drawableKeys.get(segment.id) ?? [];
			keys.push(line.key);
			this.drawableKeys.set(segment.id, keys);
		}
		segmentTo(segment) {
			if (segment.end !== null) return segment.end;
			if (segment.currentSelection === true) return this.status.lastConfirmedAt ?? segment.start;
			if (segment.archiveEntryId) {
				const segmentConfirmed = segment.start + Math.max(0, segment.durationMs);
				const archiveConfirmed = this.archivePaintThrough(this.status);
				return Math.max(segment.start, Math.min(segmentConfirmed, archiveConfirmed ?? segmentConfirmed));
			}
			return this.status.lastConfirmedAt ?? segment.start;
		}
		project(segment, runIndex, from, to, percentile, rc) {
			if (!this.settings.showHistory && segment.end !== null || segment.durationMs < this.settings.minDurationMs) return null;
			from = Math.max(from, segment.start + this.settings.minDurationMs);
			if (to < from || to === from && segment.currentSelection !== true) return null;
			const priceWidth = this.width(), low = segment.price, high = low + priceWidth;
			const range = rc.timeScale.visibleRange(), visibleFrom = rc.dataLayer.indexToTimeFloat(range.from) * 1e3, visibleTo = rc.dataLayer.indexToTimeFloat(range.to) * 1e3;
			if (to < visibleFrom || from > visibleTo) return null;
			const startLogical = wallTimestampToLogical$1(from, rc.dataLayer.timeToIndexFloat.bind(rc.dataLayer));
			const endLogical = wallTimestampToLogical$1(to, rc.dataLayer.timeToIndexFloat.bind(rc.dataLayer));
			if (startLogical === null || endLogical === null) return null;
			const x = rc.timeScale.indexToX(startLogical), right = rc.timeScale.indexToX(endLogical), y = rc.priceScale.priceToY(this.settings.aggregation === "native" ? low : (low + high) / 2);
			if (![
				x,
				right,
				y
			].every(Number.isFinite) || y < 0 || y > rc.plotHeight || right < 0 || x > rc.plotWidth) return null;
			return {
				key: `${segment.id}@${from}`,
				segment,
				runIndex,
				from,
				to,
				percentile,
				usd: segment.valueRuns[runIndex]?.usd ?? null,
				x: Math.max(0, x),
				right: Math.min(rc.plotWidth, right),
				y,
				low,
				high
			};
		}
		orderWallAt(x, y) {
			let best, bestDistance = Infinity;
			const tolerance = Math.max(4, this.settings.thicknessPx / 2 + 2);
			for (const line of this.drawable.values()) {
				if (x < line.x || x > Math.max(line.x + 1, line.right)) continue;
				const distance = Math.abs(y - line.y);
				if (distance <= tolerance && distance < bestDistance) {
					best = line;
					bestDistance = distance;
				}
			}
			const ratio = best ? Math.max(0, Math.min(1, (x - best.x) / Math.max(1, best.right - best.x))) : 0;
			const projected = best ? this.timeAtX?.(x) : void 0;
			if (!best) return null;
			const at = best.from === best.to ? best.from : Number.isFinite(projected) ? projected : best.from + (best.to - best.from) * ratio;
			const segment = this.segments.get(best.segment.id) ?? best.segment;
			return {
				segment,
				x,
				y,
				at,
				priceLow: best.low,
				priceHigh: best.high,
				percentile: orderWallValuePointAt(segment, at)?.percentile ?? null
			};
		}
		diagnostics() {
			const sorted = [...this.durations].sort((a, b) => a - b);
			return {
				...this.stats,
				paintedViewport: this.paintedViewport ? { ...this.paintedViewport } : void 0,
				inputRevision: this.inputRevision,
				paintedRevision: this.paintedRevision,
				pendingProjectionSegments: this.dirty.size + this.tailDirty.size,
				retainedPaintPaths: this.paintPaths?.length ?? 0,
				retainedSegments: this.segments.size,
				openSegments: this.openIds.size,
				retainedReferenceSegments: this.referenceExtents.size,
				referenceExtentValues: this.referenceCounts.size,
				pendingReferenceSegments: this.referenceIds.size,
				referenceMinimum: this.reference.min,
				referenceMaximum: this.reference.max,
				retainedDrawables: this.drawable.size,
				p95RenderMs: sorted[Math.floor((sorted.length - 1) * .95)] ?? 0
			};
		}
		measureOne(id) {
			const before = this.sizes.get(id) ?? 0, s = this.segments.get(id);
			const next = s ? 192 + s.valueRuns.length * 40 : 0;
			this.stats.bytes += next - before;
			if (next) this.sizes.set(id, next);
			else this.sizes.delete(id);
		}
		measureBytes() {
			this.stats.bytes = 0;
			this.sizes.clear();
			for (const id of this.segments.keys()) this.measureOne(id);
			this.referenceDirty = true;
		}
	};
	function isArchiveSegment$1(segment) {
		return typeof segment.archiveEntryId === "string" && segment.archiveEntryId.length > 0;
	}
	function lowerBoundRun$1(runs, at) {
		let low = 0, high = runs.length;
		while (low < high) {
			const mid = low + high >>> 1;
			if (runs[mid].at < at) low = mid + 1;
			else high = mid;
		}
		return low;
	}
	function upperBoundRun$1(runs, at) {
		let low = 0, high = runs.length;
		while (low < high) {
			const mid = low + high >>> 1;
			if (runs[mid].at <= at) low = mid + 1;
			else high = mid;
		}
		return low;
	}
	function validSegment$1(value) {
		return !!value && typeof value.id === "string" && (typeof value.epoch === "string" && value.epoch.length > 0 || typeof value.epoch === "number" && Number.isFinite(value.epoch)) && (value.side === "bid" || value.side === "ask") && [
			value.price,
			value.start,
			value.peakUsd,
			value.meanUsd,
			value.durationMs
		].every(Number.isFinite) && value.price > 0 && value.peakUsd >= 0 && value.meanUsd >= 0 && value.durationMs >= 0 && (value.end === null || Number.isFinite(value.end)) && (value.percentile === null || Number.isFinite(value.percentile));
	}
	function wallColor$1(rankValue, mode, side) {
		if (mode === "bid-ask") return side === "bid" ? "#2ebc79" : "#ed5964";
		const rank = rankValue ?? 0;
		return rank >= 99.9 ? "#ff884d" : rank >= 99 ? "#f1cb59" : "#37c4d2";
	}
	//#endregion
	//#region src/chart/order-walls.ts
	var TOP_HEAT = {
		bid: [
			"#33778c",
			"#45bcd0",
			"#f1cb59",
			"#ff884d"
		],
		ask: [
			"#666da5",
			"#8b99eb",
			"#e9c15b",
			"#ff8766"
		]
	};
	var TOP_SIDE = {
		bid: [
			"#28644b",
			"#3d9970",
			"#66d39a",
			"#b6f1aa"
		],
		ask: [
			"#7b3f4b",
			"#bf6273",
			"#ed9a9e",
			"#ffd0b0"
		]
	};
	/** The chart data layer preserves sub-candle event times as fractional logical indices. */
	function wallTimestampToLogical(timeMs, timeToIndexFloat) {
		if (!Number.isFinite(timeMs)) return null;
		const logical = timeToIndexFloat(timeMs / 1e3);
		return Number.isFinite(logical) ? logical : null;
	}
	/** Exact knots of the public piecewise-linear time mapping, relative to the
	* visible origin. Axis padding/tail changes outside these knots do not move
	* visible geometry. Keep work bounded; an unprovable mapping disables reuse. */
	function wallProjectionMappingKey(rc) {
		const range = rc.timeScale.visibleRange(), lo = Math.floor(range.from), hi = Math.ceil(range.to);
		if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || !(range.to > range.from) || hi - lo > 4096) return;
		const values = [
			range.to - range.from,
			rc.timeScale.indexToX(range.from),
			rc.timeScale.indexToX(range.to)
		];
		for (let index = lo; index <= hi; index++) values.push(index - range.from, rc.dataLayer.indexToTimeFloat(index));
		if (values.some((value) => !Number.isFinite(value))) return;
		return values.join(":");
	}
	var OrderWallsPrimitive$1 = class {
		cachePaintPaths;
		host;
		settings;
		intervalMs;
		status = { state: "loading" };
		segments = /* @__PURE__ */ new Map();
		openIds = /* @__PURE__ */ new Set();
		drawable = /* @__PURE__ */ new Map();
		drawableKeys = /* @__PURE__ */ new Map();
		version = 0;
		transformKey = "";
		dirty = /* @__PURE__ */ new Set();
		tailDirty = /* @__PURE__ */ new Map();
		closedDirectOrder = /* @__PURE__ */ new Map();
		closedArchiveOrder = /* @__PURE__ */ new Map();
		archiveEpisodeHistoryLimited = false;
		sizes = /* @__PURE__ */ new Map();
		reference = {
			min: 0,
			max: 0
		};
		referenceDirty = true;
		referenceIds = /* @__PURE__ */ new Set();
		referenceExtents = /* @__PURE__ */ new Map();
		referenceCounts = /* @__PURE__ */ new Map();
		referenceIndex = new OrderWallRankIndex();
		timeAtX;
		paintInvalid = true;
		paintKey = "";
		paintPaths;
		paintCounts = {
			historical: 0,
			current: 0
		};
		inputRevision = 0;
		paintedRevision = -1;
		paintedViewport;
		stats = {
			draws: 0,
			rebuilds: 0,
			patchProjects: 0,
			segments: 0,
			visible: 0,
			visibleHistorical: 0,
			visibleCurrent: 0,
			bytes: 0,
			renderMs: 0,
			maxRenderMs: 0,
			strokes: 0,
			lastProjectMs: 0,
			lastReferenceMs: 0,
			lastPaintMs: 0,
			referenceRebuilds: 0,
			referenceSegments: 0,
			referenceValueScans: 0,
			paintCacheHits: 0,
			paintCacheBuilds: 0,
			paintStyleVisits: 0,
			settingsNoops: 0,
			mappingChecks: 0,
			mappingFallbacks: 0
		};
		durations = [];
		constructor(settings, intervalMs, cachePaintPaths = true) {
			this.cachePaintPaths = cachePaintPaths;
			this.settings = { ...settings };
			this.intervalMs = intervalMs;
		}
		zOrder() {
			return "normal";
		}
		autoscaleInfo() {
			return null;
		}
		attached(host) {
			this.host = host;
		}
		detached() {
			this.clearEmptyProjection();
			this.openIds.clear();
			this.closedDirectOrder.clear();
			this.closedArchiveOrder.clear();
			this.sizes.clear();
			this.host = void 0;
			this.segments.clear();
			this.timeAtX = void 0;
			this.stats.bytes = 0;
		}
		setSettings(settings) {
			const keys = Object.keys(settings);
			if (keys.length === Object.keys(this.settings).length && keys.every((key) => Object.is(settings[key], this.settings[key]))) {
				this.stats.settingsNoops++;
				return;
			}
			this.inputRevision++;
			this.settings = { ...settings };
			this.trimHistory();
			this.referenceDirty = true;
			this.version++;
			this.host?.requestUpdate();
		}
		setInterval(intervalMs) {
			if (this.intervalMs !== intervalMs) {
				this.inputRevision++;
				this.intervalMs = intervalMs;
				this.transformKey = "";
				this.host?.requestUpdate();
			}
		}
		setStatus(status) {
			this.inputRevision++;
			const prior = this.status;
			this.status = this.effectiveStatus(status);
			this.advanceOpenTails(prior);
			this.host?.requestUpdate();
		}
		setSnapshot(segments, status) {
			this.inputRevision++;
			this.status = { ...status };
			this.archiveEpisodeHistoryLimited = status.episodeHistoryLimited === true;
			this.clearEmptyProjection();
			this.openIds.clear();
			this.closedDirectOrder.clear();
			this.closedArchiveOrder.clear();
			this.sizes.clear();
			this.segments.clear();
			for (const segment of segments) if (validSegment(segment) && !this.beforeRetention(segment)) {
				this.segments.set(segment.id, segment);
				if (segment.end === null) this.openIds.add(segment.id);
			}
			for (const segment of [...this.segments.values()].filter((s) => s.end !== null).sort((a, b) => a.end - b.end)) this.rememberClosed(segment);
			this.trimHistory();
			this.status = this.effectiveStatus(status);
			this.dirty = new Set(this.segments.keys());
			this.version++;
			this.transformKey = "";
			this.measureBytes();
			this.host?.requestUpdate();
		}
		patch(patches, status) {
			this.inputRevision++;
			const prior = this.status;
			this.status = { ...status };
			for (const patch of patches) {
				if (!patch.segment || !validSegment(patch.segment) || this.beforeRetention(patch.segment)) {
					this.segments.delete(patch.id);
					this.openIds.delete(patch.id);
					this.removeProjection(patch.id);
					this.closedDirectOrder.delete(patch.id);
					this.closedArchiveOrder.delete(patch.id);
					continue;
				}
				const previous = this.segments.get(patch.id), next = patch.segment;
				this.segments.set(patch.id, next);
				if (next.end === null) this.openIds.add(patch.id);
				else this.openIds.delete(patch.id);
				const shifted = Boolean(previous && (previous.valueRunsTruncated !== next.valueRunsTruncated || previous.valueRuns[0] && next.valueRuns[0] && previous.valueRuns[0].at !== next.valueRuns[0].at));
				if (!previous || patch.replaceValueRuns === true || shifted || previous.price !== next.price || previous.start !== next.start) {
					this.dirty.add(patch.id);
					this.tailDirty.delete(patch.id);
				} else this.markTail(patch.id, Math.max(0, next.valueRuns.length - (patch.valuePoints?.length ?? 0) - 1));
			}
			for (const patch of patches) {
				const next = this.segments.get(patch.id);
				if (next?.end !== null && next) this.rememberClosed(next);
				else {
					this.closedDirectOrder.delete(patch.id);
					this.closedArchiveOrder.delete(patch.id);
				}
				this.measureOne(patch.id);
				this.markReference(patch.id);
			}
			this.trimHistory();
			this.status = this.effectiveStatus(status);
			this.advanceOpenTails(prior);
			if (!this.segments.size) this.clearEmptyProjection();
			this.host?.requestUpdate();
		}
		removeProjection(id) {
			this.removeDrawables(id);
			this.dirty.delete(id);
			this.tailDirty.delete(id);
			this.referenceIds.delete(id);
			const extent = this.referenceExtents.get(id);
			if (extent) {
				this.countReference(extent.min, -1);
				this.countReference(extent.max, -1);
				this.referenceExtents.delete(id);
			}
		}
		clearEmptyProjection() {
			this.paintedViewport = void 0;
			this.paintPaths = void 0;
			this.paintInvalid = true;
			this.paintKey = "";
			this.paintCounts = {
				historical: 0,
				current: 0
			};
			this.drawable.clear();
			this.drawableKeys.clear();
			this.dirty.clear();
			this.tailDirty.clear();
			this.clearReference();
			this.referenceDirty = true;
			this.stats.referenceSegments = 0;
			this.stats.referenceValueScans = 0;
			this.stats.segments = 0;
			this.stats.visible = 0;
			this.stats.visibleHistorical = 0;
			this.stats.visibleCurrent = 0;
		}
		markReference(id) {
			if (this.referenceDirty) {
				this.referenceIds.clear();
				return;
			}
			if (this.segments.has(id) || this.referenceExtents.has(id)) this.referenceIds.add(id);
			else this.referenceIds.delete(id);
		}
		clearReference() {
			this.reference = {
				min: 0,
				max: 0
			};
			this.referenceIds.clear();
			this.referenceExtents.clear();
			this.referenceCounts.clear();
			this.referenceIndex.clear();
		}
		countReference(value, delta) {
			const count = (this.referenceCounts.get(value) ?? 0) + delta;
			if (count > 0) this.referenceCounts.set(value, count);
			else this.referenceCounts.delete(value);
			this.referenceIndex.set(value, Math.max(0, count));
		}
		updateReference(id) {
			const previous = this.referenceExtents.get(id);
			this.stats.referenceSegments++;
			let min = Infinity, max = 0;
			const accept = (value) => {
				this.stats.referenceValueScans++;
				if (value !== null && value > 0) {
					min = Math.min(min, value);
					max = Math.max(max, value);
				}
			};
			if (this.settings.visibleRangeOnly) for (const key of this.drawableKeys.get(id) ?? []) {
				const line = this.drawable.get(key);
				if (line) accept(line.usd);
			}
			else {
				const segment = this.segments.get(id);
				if (segment && (this.settings.showHistory || segment.end === null)) for (const run of segment.valueRuns) accept(run.usd);
			}
			if (previous && previous.min === min && previous.max === max) return;
			if (previous) {
				this.countReference(previous.min, -1);
				this.countReference(previous.max, -1);
				this.referenceExtents.delete(id);
			}
			if (max > 0) {
				this.referenceExtents.set(id, {
					min,
					max
				});
				this.countReference(min, 1);
				this.countReference(max, 1);
			}
		}
		rememberClosed(segment) {
			if (isArchiveSegment(segment)) this.closedArchiveOrder.set(segment.id, true);
			else this.closedDirectOrder.set(segment.id, true);
		}
		trimHistory() {
			while (this.closedDirectOrder.size > this.settings.historyEpisodes) {
				const id = this.closedDirectOrder.keys().next().value;
				this.closedDirectOrder.delete(id);
				this.segments.delete(id);
				this.removeProjection(id);
				this.measureOne(id);
			}
			while (this.closedArchiveOrder.size > ORDER_WALL_ARCHIVE_MAX_SEGMENTS) {
				const id = this.closedArchiveOrder.keys().next().value;
				this.closedArchiveOrder.delete(id);
				this.segments.delete(id);
				this.removeProjection(id);
				this.measureOne(id);
				this.archiveEpisodeHistoryLimited = true;
			}
		}
		effectiveStatus(status) {
			return this.archiveEpisodeHistoryLimited ? {
				...status,
				episodeHistoryLimited: true,
				...status.coverage ? { coverage: {
					...status.coverage,
					complete: false,
					partial: true
				} } : {}
			} : status;
		}
		beforeRetention(segment) {
			return this.status.retentionStart !== void 0 && (segment.end ?? this.status.lastConfirmedAt ?? segment.start) <= this.status.retentionStart;
		}
		width() {
			return this.settings.aggregation === "native" ? this.status.tickSize ?? .1 : this.settings.aggregation === "auto" ? this.status.resolvedPriceWidth ?? this.status.tickSize ?? .1 : this.settings.aggregation;
		}
		archivePaintThrough(status) {
			const a = status.archive?.loadedThrough, b = status.archive?.presentationThrough;
			return a === void 0 ? b : b === void 0 ? a : Math.max(a, b);
		}
		advanceOpenTails(prior) {
			const current = prior.lastConfirmedAt !== this.status.lastConfirmedAt, archive = this.archivePaintThrough(prior) !== this.archivePaintThrough(this.status);
			if (!current && !archive) return;
			for (const id of this.openIds) {
				const segment = this.segments.get(id);
				if (segment && (segment.archiveEntryId && !segment.currentSelection ? archive : current)) this.markTail(id, Math.max(0, segment.valueRuns.length - 1));
			}
		}
		markTail(id, index) {
			if (this.dirty.has(id)) return;
			this.tailDirty.set(id, Math.min(index, this.tailDirty.get(id) ?? index));
		}
		draw(ctx, rc) {
			if (!this.settings.enabled || !this.segments.size) return;
			const started = performance.now(), range = rc.timeScale.visibleRange(), prices = rc.priceScale.priceRange(), dpr = rc.dpr;
			this.timeAtX = (x) => rc.dataLayer.indexToTimeFloat(rc.timeScale.xToIndex(x)) * 1e3;
			this.stats.mappingChecks++;
			const mapping = wallProjectionMappingKey(rc);
			if (mapping === void 0) this.stats.mappingFallbacks++;
			const axis = mapping ?? `unproven:${this.stats.mappingChecks}`;
			const key = [
				this.version,
				this.intervalMs,
				prices.min,
				prices.max,
				rc.plotWidth,
				rc.plotHeight,
				dpr,
				this.width(),
				axis
			].join(":");
			if (key !== this.transformKey) {
				if (this.settings.visibleRangeOnly) this.referenceDirty = true;
				this.drawable.clear();
				this.drawableKeys.clear();
				this.tailDirty.clear();
				this.dirty = new Set(this.segments.keys());
				this.transformKey = key;
				this.stats.rebuilds++;
			}
			const projectionStarted = performance.now();
			if (this.dirty.size) {
				for (const id of this.dirty) {
					if (this.settings.visibleRangeOnly) this.markReference(id);
					this.removeDrawables(id);
					const segment = this.segments.get(id);
					if (segment) this.projectAll(segment, rc);
					this.stats.patchProjects++;
				}
				this.dirty.clear();
			}
			if (this.tailDirty.size) {
				for (const [id, index] of this.tailDirty) {
					if (this.settings.visibleRangeOnly) this.markReference(id);
					const segment = this.segments.get(id);
					if (segment) this.projectTail(segment, index, rc);
					this.stats.patchProjects++;
				}
				this.tailDirty.clear();
			}
			this.stats.lastProjectMs = performance.now() - projectionStarted;
			const referenceStarted = performance.now();
			this.stats.referenceSegments = 0;
			this.stats.referenceValueScans = 0;
			if (this.referenceDirty) {
				this.clearReference();
				this.stats.referenceRebuilds++;
				for (const id of this.settings.visibleRangeOnly ? this.drawableKeys.keys() : this.segments.keys()) this.updateReference(id);
				this.referenceDirty = false;
			} else for (const id of this.referenceIds) this.updateReference(id);
			this.referenceIds.clear();
			const referenceMin = this.referenceIndex.min;
			this.reference = {
				min: referenceMin !== void 0 && Number.isFinite(referenceMin) ? referenceMin : 0,
				max: this.referenceIndex.max ?? 0
			};
			this.stats.lastReferenceMs = performance.now() - referenceStarted;
			const paintStarted = performance.now();
			this.stats.strokes = 0;
			this.stats.visibleHistorical = 0;
			this.stats.visibleCurrent = 0;
			this.stats.draws++;
			this.stats.segments = this.segments.size;
			this.stats.visible = this.drawable.size;
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, rc.plotWidth * dpr, rc.plotHeight * dpr);
			ctx.clip();
			ctx.globalAlpha = this.settings.opacity;
			ctx.lineWidth = this.settings.thicknessPx * dpr;
			ctx.lineCap = "butt";
			ctx.setLineDash([]);
			const paintKey = key + ":" + this.reference.min + ":" + this.reference.max;
			const cacheable = this.cachePaintPaths && typeof Path2D !== "undefined";
			if (cacheable && !this.paintInvalid && this.paintKey === paintKey && this.paintPaths) {
				for (const entry of this.paintPaths) {
					ctx.strokeStyle = entry.color;
					ctx.lineWidth = entry.thickness * dpr;
					ctx.stroke(entry.path);
					this.stats.strokes++;
				}
				this.stats.visibleHistorical = this.paintCounts.historical;
				this.stats.visibleCurrent = this.paintCounts.current;
				this.stats.paintCacheHits++;
			} else {
				const compiled = [];
				const stroke = (color, thickness, lines) => {
					ctx.strokeStyle = color;
					ctx.lineWidth = thickness * dpr;
					if (cacheable) {
						const path = new Path2D();
						for (const [x, right, y] of lines) {
							path.moveTo(x * dpr, y * dpr);
							path.lineTo(right * dpr, y * dpr);
						}
						ctx.stroke(path);
						compiled.push({
							color,
							thickness,
							path
						});
					} else {
						ctx.beginPath();
						for (const [x, right, y] of lines) {
							ctx.moveTo(x * dpr, y * dpr);
							ctx.lineTo(right * dpr, y * dpr);
						}
						ctx.stroke();
					}
					this.stats.strokes++;
				};
				let group;
				const paths = /* @__PURE__ */ new Map();
				const strokeGroup = () => {
					if (!group) return;
					if (group.top) {
						const key = `${group.color}:${group.thickness}`, path = paths.get(key) ?? {
							color: group.color,
							thickness: group.thickness,
							lines: []
						};
						path.lines.push([
							group.x,
							group.right,
							group.y
						]);
						paths.set(key, path);
					} else stroke(group.color, group.thickness, [[
						group.x,
						group.right,
						group.y
					]]);
					group = void 0;
				};
				for (const line of this.drawable.values()) {
					this.stats.paintStyleVisits++;
					if (line.segment.currentSelection) this.stats.visibleCurrent++;
					else if (line.segment.archiveEntryId) this.stats.visibleHistorical++;
					const style = this.lineStyle(line), color = style.color, right = Math.max(line.x + (line.segment.detectionMode === "top-levels" ? 1 / dpr : 1), line.right);
					if (group && group.segmentId === line.segment.id && group.epoch === line.segment.epoch && group.side === line.segment.side && group.color === color && group.thickness === style.thickness && group.to === line.from && group.low === line.low && group.high === line.high && group.y === line.y && line.x <= group.right) {
						group.to = line.to;
						group.right = Math.max(group.right, right);
						continue;
					}
					strokeGroup();
					group = {
						segmentId: line.segment.id,
						epoch: line.segment.epoch,
						side: line.segment.side,
						color,
						thickness: style.thickness,
						top: line.segment.detectionMode === "top-levels",
						from: line.from,
						to: line.to,
						x: line.x,
						right,
						y: line.y,
						low: line.low,
						high: line.high
					};
				}
				strokeGroup();
				for (const path of paths.values()) stroke(path.color, path.thickness, path.lines);
				this.paintPaths = cacheable ? compiled : void 0;
				this.paintKey = paintKey;
				this.paintInvalid = false;
				this.paintCounts = {
					historical: this.stats.visibleHistorical,
					current: this.stats.visibleCurrent
				};
				if (cacheable) this.stats.paintCacheBuilds++;
			}
			if (this.settings.showPriceLines) this.drawPriceLines(ctx, rc);
			ctx.restore();
			this.paintedRevision = this.inputRevision;
			this.paintedViewport = {
				fromMs: rc.dataLayer.indexToTimeFloat(range.from) * 1e3,
				toMs: rc.dataLayer.indexToTimeFloat(range.to) * 1e3,
				minPrice: prices.min,
				maxPrice: prices.max,
				plotWidth: rc.plotWidth,
				plotHeight: rc.plotHeight
			};
			this.stats.lastPaintMs = performance.now() - paintStarted;
			const elapsed = performance.now() - started;
			this.durations.push(elapsed);
			if (this.durations.length > 512) this.durations.shift();
			this.stats.renderMs += elapsed;
			this.stats.maxRenderMs = Math.max(this.stats.maxRenderMs, elapsed);
		}
		/** Presentation-only guides: never extend the recorded wall timeline itself. */
		drawPriceLines(ctx, rc) {
			const active = /* @__PURE__ */ new Map();
			for (const id of this.openIds) for (const key of this.drawableKeys.get(id) ?? []) {
				const line = this.drawable.get(key);
				if (!line) continue;
				const previous = active.get(id);
				if (!previous || line.from > previous.from) active.set(id, line);
			}
			const dpr = rc.dpr, occupied = [];
			ctx.font = `${10 * dpr}px ui-monospace, monospace`;
			ctx.textBaseline = "middle";
			ctx.textAlign = "right";
			const lines = [...active.values()].map((line) => ({
				line,
				segment: this.segments.get(line.segment.id)
			})).sort((a, b) => (b.segment.valueRuns.at(-1)?.usd ?? 0) - (a.segment.valueRuns.at(-1)?.usd ?? 0));
			for (const { line, segment } of lines) {
				const value = orderWallValuePointAt(segment, Math.min(line.to, this.segmentTo(segment)));
				if (!value || !Number.isFinite(value.usd) || line.y < 8 || line.y > rc.plotHeight - 8) continue;
				const color = this.lineStyle({
					...line,
					usd: value.usd,
					percentile: value.percentile
				}).color;
				ctx.strokeStyle = color;
				ctx.globalAlpha = this.settings.opacity * .28;
				ctx.lineWidth = dpr;
				ctx.setLineDash([2 * dpr, 4 * dpr]);
				if (line.segment.detectionMode !== "top-levels") {
					ctx.beginPath();
					ctx.moveTo(0, line.y * dpr);
					ctx.lineTo(rc.plotWidth * dpr, line.y * dpr);
					ctx.stroke();
				}
				if (occupied.some((y) => Math.abs(y - line.y) < 15)) continue;
				const price = (this.settings.aggregation === "native" ? line.low : (line.low + line.high) / 2).toLocaleString("en-US", { maximumFractionDigits: 8 });
				const size = value.usd.toLocaleString("en-US", {
					notation: "compact",
					maximumFractionDigits: 1
				});
				const text = `${this.status.state !== "live" ? "~" : ""}${line.segment.side === "bid" ? "B" : "A"} ${price} · $${size}`;
				const width = ctx.measureText(text).width + 10 * dpr;
				if (width > rc.plotWidth * dpr - 8 * dpr) continue;
				occupied.push(line.y);
				ctx.globalAlpha = .94;
				ctx.fillStyle = rc.theme.background;
				ctx.fillRect(rc.plotWidth * dpr - width - 4 * dpr, (line.y - 7) * dpr, width, 14 * dpr);
				ctx.globalAlpha = this.settings.opacity * .45;
				ctx.strokeStyle = color;
				ctx.setLineDash([]);
				ctx.strokeRect(rc.plotWidth * dpr - width - 4 * dpr, (line.y - 7) * dpr, width, 14 * dpr);
				ctx.globalAlpha = this.settings.opacity;
				ctx.fillStyle = rc.theme.axisText;
				ctx.fillText(text, (rc.plotWidth - 9) * dpr, line.y * dpr);
			}
		}
		lineStyle(line) {
			if (line.segment.detectionMode !== "top-levels") return {
				color: wallColor(line.percentile, this.settings.colorMode, line.segment.side),
				thickness: this.settings.thicknessPx
			};
			if (line.usd === null) return {
				color: "#6b6b6b",
				thickness: 1
			};
			const { min, max } = this.reference, v = line.usd ?? min;
			const strength = max <= 0 ? 0 : this.settings.highContrast ? max === min ? .5 : Math.max(0, Math.min(1, (v - min) / (max - min))) : Math.max(0, Math.min(1, v / max));
			const tier = strength >= .85 ? 3 : strength >= .55 ? 2 : strength >= .25 ? 1 : 0;
			const heat = TOP_HEAT[line.segment.side], side = TOP_SIDE[line.segment.side];
			return {
				color: (this.settings.colorMode === "heat" ? heat : side)[tier],
				thickness: this.settings.strengthThickness ? 1 + (this.settings.thicknessPx - 1) * tier / 3 : this.settings.thicknessPx
			};
		}
		projectAll(segment, rc) {
			if (segment.detectionMode === "top-levels" && segment.valueRunsTruncated && segment.valueRuns.length > 0 && segment.valueRuns[0].at > segment.start) {
				const line = this.project(segment, -1, segment.start, segment.valueRuns[0].at, null, rc);
				if (line) {
					this.paintInvalid = true;
					this.drawable.set(line.key, line);
					this.drawableKeys.set(segment.id, [line.key]);
				}
			}
			if (segment.valueRuns.length) {
				const range = rc.timeScale.visibleRange();
				const visibleFrom = rc.dataLayer.indexToTimeFloat(range.from) * 1e3, visibleTo = rc.dataLayer.indexToTimeFloat(range.to) * 1e3;
				const first = Math.max(0, lowerBoundRun(segment.valueRuns, visibleFrom) - 1);
				const afterLast = Math.min(segment.valueRuns.length, Math.max(first + 1, upperBoundRun(segment.valueRuns, visibleTo)));
				for (let index = first; index < afterLast; index++) this.projectIndex(segment, index, rc);
				return;
			}
			const to = this.segmentTo(segment);
			const line = this.project(segment, 0, segment.start, to, null, rc);
			if (line) {
				this.paintInvalid = true;
				this.drawable.set(line.key, line);
				this.drawableKeys.set(segment.id, [line.key]);
			}
		}
		projectTail(segment, fromIndex, rc) {
			if (!segment.valueRuns.length) {
				this.removeDrawables(segment.id);
				this.projectAll(segment, rc);
				return;
			}
			const keys = this.drawableKeys.get(segment.id) ?? [];
			for (const key of keys) {
				const drawable = this.drawable.get(key);
				if (drawable && drawable.runIndex >= fromIndex) {
					this.paintInvalid = true;
					this.drawable.delete(key);
				}
			}
			this.drawableKeys.set(segment.id, keys.filter((key) => this.drawable.has(key)));
			for (let i = fromIndex; i < segment.valueRuns.length; i++) this.projectIndex(segment, i, rc);
		}
		removeDrawables(id) {
			const keys = this.drawableKeys.get(id) ?? [];
			if (keys.length) this.paintInvalid = true;
			for (const key of keys) this.drawable.delete(key);
			this.drawableKeys.delete(id);
		}
		projectIndex(segment, index, rc) {
			const value = segment.valueRuns[index];
			if (!value) return;
			const next = segment.valueRuns[index + 1], from = value.at, to = Math.min(next?.at ?? this.segmentTo(segment), this.segmentTo(segment));
			const line = this.project(segment, index, from, to, value.percentile, rc);
			if (!line) return;
			this.paintInvalid = true;
			this.drawable.set(line.key, line);
			const keys = this.drawableKeys.get(segment.id) ?? [];
			keys.push(line.key);
			this.drawableKeys.set(segment.id, keys);
		}
		segmentTo(segment) {
			if (segment.end !== null) return segment.end;
			if (segment.currentSelection === true) return this.status.lastConfirmedAt ?? segment.start;
			if (segment.archiveEntryId) {
				const segmentConfirmed = segment.start + Math.max(0, segment.durationMs);
				const archiveConfirmed = this.archivePaintThrough(this.status);
				return Math.max(segment.start, Math.min(segmentConfirmed, archiveConfirmed ?? segmentConfirmed));
			}
			return this.status.lastConfirmedAt ?? segment.start;
		}
		project(segment, runIndex, from, to, percentile, rc) {
			if (!this.settings.showHistory && segment.end !== null || segment.durationMs < this.settings.minDurationMs) return null;
			from = Math.max(from, segment.start + this.settings.minDurationMs);
			if (to < from || to === from && segment.currentSelection !== true) return null;
			const priceWidth = this.width(), low = segment.price, high = low + priceWidth;
			const range = rc.timeScale.visibleRange(), visibleFrom = rc.dataLayer.indexToTimeFloat(range.from) * 1e3, visibleTo = rc.dataLayer.indexToTimeFloat(range.to) * 1e3;
			if (to < visibleFrom || from > visibleTo) return null;
			const startLogical = wallTimestampToLogical(from, rc.dataLayer.timeToIndexFloat.bind(rc.dataLayer));
			const endLogical = wallTimestampToLogical(to, rc.dataLayer.timeToIndexFloat.bind(rc.dataLayer));
			if (startLogical === null || endLogical === null) return null;
			const x = rc.timeScale.indexToX(startLogical), right = rc.timeScale.indexToX(endLogical), y = rc.priceScale.priceToY(this.settings.aggregation === "native" ? low : (low + high) / 2);
			if (![
				x,
				right,
				y
			].every(Number.isFinite) || y < 0 || y > rc.plotHeight || right < 0 || x > rc.plotWidth) return null;
			return {
				key: `${segment.id}@${from}`,
				segment,
				runIndex,
				from,
				to,
				percentile,
				usd: segment.valueRuns[runIndex]?.usd ?? null,
				x: Math.max(0, x),
				right: Math.min(rc.plotWidth, right),
				y,
				low,
				high
			};
		}
		orderWallAt(x, y) {
			let best, bestDistance = Infinity;
			const tolerance = Math.max(4, this.settings.thicknessPx / 2 + 2);
			for (const line of this.drawable.values()) {
				if (x < line.x || x > Math.max(line.x + 1, line.right)) continue;
				const distance = Math.abs(y - line.y);
				if (distance <= tolerance && distance < bestDistance) {
					best = line;
					bestDistance = distance;
				}
			}
			const ratio = best ? Math.max(0, Math.min(1, (x - best.x) / Math.max(1, best.right - best.x))) : 0;
			const projected = best ? this.timeAtX?.(x) : void 0;
			if (!best) return null;
			const at = best.from === best.to ? best.from : Number.isFinite(projected) ? projected : best.from + (best.to - best.from) * ratio;
			const segment = this.segments.get(best.segment.id) ?? best.segment;
			return {
				segment,
				x,
				y,
				at,
				priceLow: best.low,
				priceHigh: best.high,
				percentile: orderWallValuePointAt(segment, at)?.percentile ?? null
			};
		}
		diagnostics() {
			const sorted = [...this.durations].sort((a, b) => a - b);
			return {
				...this.stats,
				paintedViewport: this.paintedViewport ? { ...this.paintedViewport } : void 0,
				inputRevision: this.inputRevision,
				paintedRevision: this.paintedRevision,
				pendingProjectionSegments: this.dirty.size + this.tailDirty.size,
				retainedPaintPaths: this.paintPaths?.length ?? 0,
				retainedSegments: this.segments.size,
				openSegments: this.openIds.size,
				retainedReferenceSegments: this.referenceExtents.size,
				referenceExtentValues: this.referenceCounts.size,
				pendingReferenceSegments: this.referenceIds.size,
				referenceMinimum: this.reference.min,
				referenceMaximum: this.reference.max,
				retainedDrawables: this.drawable.size,
				p95RenderMs: sorted[Math.floor((sorted.length - 1) * .95)] ?? 0
			};
		}
		measureOne(id) {
			const before = this.sizes.get(id) ?? 0, s = this.segments.get(id);
			const next = s ? 192 + s.valueRuns.length * 40 : 0;
			this.stats.bytes += next - before;
			if (next) this.sizes.set(id, next);
			else this.sizes.delete(id);
		}
		measureBytes() {
			this.stats.bytes = 0;
			this.sizes.clear();
			for (const id of this.segments.keys()) this.measureOne(id);
			this.referenceDirty = true;
		}
	};
	function isArchiveSegment(segment) {
		return typeof segment.archiveEntryId === "string" && segment.archiveEntryId.length > 0;
	}
	function lowerBoundRun(runs, at) {
		let low = 0, high = runs.length;
		while (low < high) {
			const mid = low + high >>> 1;
			if (runs[mid].at < at) low = mid + 1;
			else high = mid;
		}
		return low;
	}
	function upperBoundRun(runs, at) {
		let low = 0, high = runs.length;
		while (low < high) {
			const mid = low + high >>> 1;
			if (runs[mid].at <= at) low = mid + 1;
			else high = mid;
		}
		return low;
	}
	function validSegment(value) {
		return !!value && typeof value.id === "string" && (typeof value.epoch === "string" && value.epoch.length > 0 || typeof value.epoch === "number" && Number.isFinite(value.epoch)) && (value.side === "bid" || value.side === "ask") && [
			value.price,
			value.start,
			value.peakUsd,
			value.meanUsd,
			value.durationMs
		].every(Number.isFinite) && value.price > 0 && value.peakUsd >= 0 && value.meanUsd >= 0 && value.durationMs >= 0 && (value.end === null || Number.isFinite(value.end)) && (value.percentile === null || Number.isFinite(value.percentile));
	}
	function wallColor(rankValue, mode, side) {
		if (mode === "bid-ask") return side === "bid" ? "#2ebc79" : "#ed5964";
		const rank = rankValue ?? 0;
		return rank >= 99.9 ? "#ff884d" : rank >= 99 ? "#f1cb59" : "#37c4d2";
	}
	//#endregion
	//#region ../iqterminal/node_modules/.pnpm/openalgo-charts@2.6.0/node_modules/openalgo-charts/dist/openalgo-charts.mjs
	var i = {
		None: 0,
		Cursor: 1,
		Light: 2,
		Full: 3
	};
	var s = class {
		constructor(e = i.None) {
			Object.defineProperty(this, "_globalLevel", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_panes", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_timeScaleOps", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), this._globalLevel = e;
		}
		get globalLevel() {
			return this._globalLevel;
		}
		invalidateGlobal(e) {
			e > this._globalLevel && (this._globalLevel = e);
		}
		invalidatePane(e, t) {
			var i, s;
			this._panes.set(e, (i = this._panes.get(e), s = t, void 0 === i ? { ...s } : {
				level: Math.max(i.level, s.level),
				autoScale: i.autoScale || s.autoScale
			}));
		}
		paneInvalidation(e) {
			return this._panes.get(e);
		}
		panes() {
			return this._panes;
		}
		addTimeScaleOp(e) {
			this._timeScaleOps.push(e);
		}
		timeScaleOps() {
			return this._timeScaleOps;
		}
		isEmpty() {
			return this._globalLevel === i.None && 0 === this._panes.size && 0 === this._timeScaleOps.length;
		}
		merge(e) {
			this.invalidateGlobal(e._globalLevel);
			for (const [t, i] of e._panes) this.invalidatePane(t, i);
			e._timeScaleOps.length > 0 && (this._timeScaleOps = this._timeScaleOps.concat(e._timeScaleOps));
		}
	};
	var r = () => {};
	var n = class {
		constructor(e, t, i = r) {
			Object.defineProperty(this, "_onFrame", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_schedule", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_cancel", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_handle", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), this._onFrame = e, this._schedule = t, this._cancel = i;
		}
		get scheduled() {
			return null !== this._handle;
		}
		requestFrame() {
			if (null !== this._handle) return;
			this._handle = -1;
			const e = this._schedule(() => {
				this._handle = null, this._onFrame();
			});
			null !== this._handle && (this._handle = e);
		}
		stop() {
			null !== this._handle && (this._cancel(this._handle), this._handle = null);
		}
	};
	function o(e, t, i) {
		return e < t ? t : e > i ? i : e;
	}
	function l(e, t) {
		return t <= 0 ? e : Math.round(e / t) * t;
	}
	function h(e, t, i) {
		return {
			width: Math.round(e * i),
			height: Math.round(t * i)
		};
	}
	function c(e, t) {
		return Math.round(e * t) / t;
	}
	var d = class {
		constructor(e, t) {
			Object.defineProperty(this, "element", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "ctx", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_mediaWidth", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_mediaHeight", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_dpr", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 1
			}), Object.defineProperty(this, "_deviceWidth", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_deviceHeight", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), this.element = e.createElement("canvas");
			const i = this.element.getContext("2d");
			if (null === i) throw new Error("openalgo-charts: 2D canvas context is not available");
			this.ctx = i;
			const s = this.element.style;
			s.position = "absolute", s.top = "0", s.left = "0", s.width = "100%", s.height = "100%", s.zIndex = String(t);
		}
		get mediaWidth() {
			return this._mediaWidth;
		}
		get mediaHeight() {
			return this._mediaHeight;
		}
		get pixelRatio() {
			return this._dpr;
		}
		resize(e, t, i) {
			if (e === this._mediaWidth && t === this._mediaHeight && i === this._dpr) return;
			this._mediaWidth = e, this._mediaHeight = t, this._dpr = i;
			const s = h(e, t, i);
			this.element.width = this._snapsTo(this._deviceWidth, e * i) ?? s.width, this.element.height = this._snapsTo(this._deviceHeight, t * i) ?? s.height, this.element.style.width = `${e}px`, this.element.style.height = `${t}px`;
		}
		setDeviceSize(e, t) {
			const i = this._reported(e, this._mediaWidth * this._dpr), s = this._reported(t, this._mediaHeight * this._dpr);
			return null === i || null === s ? (this.forgetDeviceSize(), !1) : (this._deviceWidth = i, this._deviceHeight = s, (this.element.width !== i || this.element.height !== s) && (this.element.width = i, this.element.height = s, !0));
		}
		forgetDeviceSize() {
			this._deviceWidth = 0, this._deviceHeight = 0;
		}
		_reported(e, t) {
			return Number.isInteger(e) && e > 0 && Math.abs(e - t) <= 1 ? e : null;
		}
		_snapsTo(e, t) {
			return e > 0 && Math.abs(e - t) < 1 ? e : null;
		}
		clearBitmap() {
			this.ctx.setTransform(1, 0, 0, 1, 0, 0), this.ctx.clearRect(0, 0, this.element.width, this.element.height);
		}
	};
	function u(e) {
		const t = Math.floor(Math.log10(e)), i = e / Math.pow(10, t);
		for (const e of [
			1,
			2,
			2.5,
			5
		]) if (e > i * (1 + 1e-9)) return e * Math.pow(10, t);
		return 10 * Math.pow(10, t);
	}
	function _(e, t, i) {
		const s = Math.ceil(e / i) * i, r = Math.floor(t / i) * i;
		return Math.round((r - s) / i) + 1;
	}
	function p(e, t, i = 6) {
		if (!isFinite(e) || !isFinite(t) || t <= e) return [Number.isFinite(e) ? e : 0];
		let s = function(e) {
			if (e <= 0) return 0;
			const t = Math.floor(Math.log10(e)), i = e / Math.pow(10, t);
			let s;
			return s = i < 1.5 ? 1 : i < 3 ? 2 : i < 7 ? 5 : 10, s * Math.pow(10, t);
		}((t - e) / Math.max(1, i - 1));
		if (!(s > 0)) return [e];
		for (let r = 0; r < 20 && _(e, t, s) > i; r++) s = u(s);
		const r = Math.ceil(e / s) * s, n = Math.floor(t / s) * s, o = [], a = Math.round((n - r) / s) + 1;
		for (let e = 0; e < a && e < 1e3; e++) {
			const t = r + e * s;
			o.push(Math.abs(t) < s / 1e6 ? 0 : t);
		}
		return o;
	}
	function f(e) {
		return e <= 0 || !isFinite(e) ? 2 : e >= 1 ? 0 : Math.min(8, Math.ceil(-Math.log10(e)));
	}
	var m = [
		"linear",
		"logarithmic",
		"percentage",
		"indexed-to-100"
	];
	function b(e) {
		return "percentage" === e || "indexed-to-100" === e;
	}
	var g = {
		marginTop: .1,
		marginBottom: .1,
		minMove: 0,
		minPrecision: 0,
		mode: "linear",
		inverted: !1
	};
	function v(e, t, i, s) {
		if (!isFinite(e) || !isFinite(t)) return {
			min: 0,
			max: 1
		};
		if (t <= e) {
			const i = Math.abs(t) > 0 ? .05 * Math.abs(t) : .5;
			return {
				min: e - i,
				max: t + i
			};
		}
		const r = (t - e) / Math.max(1 - i - s, .01);
		return {
			min: e - r * s,
			max: t + r * i
		};
	}
	var y = class {
		constructor(e = {}) {
			Object.defineProperty(this, "_options", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_height", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_min", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_max", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 1
			}), Object.defineProperty(this, "_autoScale", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !0
			}), Object.defineProperty(this, "_scaled", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_baseline", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_fixedRange", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_fixedRangeOwner", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_manualRangeOverride", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_priceFormatter", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), this._options = {
				...g,
				...e
			};
		}
		get options() {
			return this._options;
		}
		setOptions(e) {
			this._options = {
				...this._options,
				...e
			}, b(this._options.mode) || (this._baseline = null);
		}
		setHeight(e) {
			this._height = e;
		}
		get height() {
			return this._height;
		}
		setPriceRange(e) {
			this._manualRangeOverride = !0, this._writePriceRange(e);
		}
		setComputedRange(e) {
			this._writePriceRange(e);
		}
		_writePriceRange(e) {
			this._min = e.min, this._max = e.max, this._scaled = !0;
		}
		get scaled() {
			return this._scaled;
		}
		setBaseline(e) {
			this._baseline = e;
		}
		get baseline() {
			return this._baseline;
		}
		priceRange() {
			return {
				min: this._min,
				max: this._max
			};
		}
		get autoScale() {
			return this._autoScale;
		}
		setAutoScale(e) {
			this._manualRangeOverride = !e, e && null !== this._fixedRange ? this._writePriceRange(this._fixedRange) : this._autoScale = e;
		}
		setFixedRange(e) {
			this._fixedRangeOwner = null, this._fixedRange = null === e ? null : { ...e }, null !== e && (this._manualRangeOverride = !0, this._autoScale = !1, this._writePriceRange(e));
		}
		setOwnedFixedRange(e, t) {
			return this._fixedRangeOwner === e && this._manualRangeOverride ? (this._fixedRange = { ...t }, !0) : !(this._manualRangeOverride || !(this._fixedRangeOwner === e || null === this._fixedRange && this._autoScale)) && (this._fixedRangeOwner = e, this._fixedRange = { ...t }, this._autoScale = !1, this._writePriceRange(t), !0);
		}
		clearOwnedFixedRange(e) {
			return !!this.ownsFixedRange(e) && (this._fixedRangeOwner = null, this._fixedRange = null, this._manualRangeOverride || (this._autoScale = !0), !0);
		}
		ownsFixedRange(e) {
			return this._fixedRangeOwner === e && null !== this._fixedRange;
		}
		ownedFixedRangeState(e) {
			return this.ownsFixedRange(e) ? { manual: this._manualRangeOverride } : null;
		}
		hasConfiguration() {
			return this._manualRangeOverride || null !== this._fixedRange || null !== this._priceFormatter || Object.keys(g).some((e) => this._options[e] !== g[e]);
		}
		get fixedRange() {
			return null === this._fixedRange ? null : { ...this._fixedRange };
		}
		reset() {
			this._autoScale && (this._min = 0, this._max = 1, this._scaled = !1, this._baseline = null);
		}
		scaleAroundCenter(e) {
			this._manualRangeOverride = !0;
			const t = (this._min + this._max) / 2, i = (this._max - this._min) / 2 * e;
			this._min = t - i, this._max = t + i, this._autoScale = !1;
		}
		scaleAtY(e, t) {
			if (!this._scaled || this._height <= 0 || !Number.isFinite(t) || t <= 0) return;
			const i = this._t(this._min), s = this._t(this._max), r = this._t(this.yToPrice(e)), n = this._tInv(r + (i - r) * t), o = this._tInv(r + (s - r) * t);
			Number.isFinite(n) && Number.isFinite(o) && o > n && (this.setPriceRange({
				min: n,
				max: o
			}), this._autoScale = !1);
		}
		panByPixels(e) {
			if (this._height <= 0 || 0 === e) return;
			const t = this._t(this._min), i = this._t(this._max), s = i - t;
			if (!(s > 0)) return;
			const r = s * ((this._options.inverted ? -e : e) / this._height);
			this._min = this._tInv(t + r), this._max = this._tInv(i + r), this._manualRangeOverride = !0, this._autoScale = !1;
		}
		autoscale(e, t, i = 1) {
			if (null !== this._fixedRange) return this._writePriceRange(this._fixedRange), !1;
			const s = v(e, t, this._options.marginTop, this._options.marginBottom), r = this._t(this._min), n = this._t(this._max), a = this._t(s.min), l = this._t(s.max), h = n - r, c = l - a, d = Math.max(Math.abs((a - r) / h), Math.abs((l - n) / h)) * this._height;
			if (!this._scaled || i >= 1 || !Number.isFinite(i) || !(h > 0) || !(c > 0) || d < .1) return this._writePriceRange(s), !1;
			const u = o(i, 0, 1), _ = (1 - u) / h + u / c, p = ((1 - u) * r / h + u * a / c) / _;
			return this._writePriceRange({
				min: this._tInv(p),
				max: this._tInv(p + 1 / _)
			}), !0;
		}
		_rebase() {
			const e = this._options.mode;
			if ("percentage" !== e && "indexed-to-100" !== e) return null;
			const t = this._baseline;
			return null !== t && isFinite(t) && t > 0 ? t : null;
		}
		_t(e) {
			if ("logarithmic" === this._options.mode) return Math.log10(Math.max(1e-10, e));
			const t = this._rebase();
			if (null === t) return e;
			const i = e / t * 100;
			return "percentage" === this._options.mode ? i - 100 : i;
		}
		_tInv(e) {
			if ("logarithmic" === this._options.mode) return Math.pow(10, e);
			const t = this._rebase();
			return null === t ? e : ("percentage" === this._options.mode ? e + 100 : e) * t / 100;
		}
		priceToY(e) {
			const t = this._t(this._min), i = this._t(this._max) - t;
			if (i <= 0) return this._height / 2;
			const s = (this._t(e) - t) / i;
			return this._options.inverted ? this._height * s : this._height * (1 - s);
		}
		yToPrice(e) {
			const t = this._t(this._min), i = this._t(this._max) - t, s = this._options.inverted ? e / this._height : 1 - e / this._height;
			return this._tInv(t + s * i);
		}
		precision() {
			if (null !== this._rebase()) return Math.max(2, f((this._t(this._max) - this._t(this._min)) / 100));
			if (this._options.minMove > 0) return f(this._options.minMove);
			const e = f((this._max - this._min) / 100), t = Math.max(Math.abs(this._min), Math.abs(this._max));
			return !Number.isFinite(t) || t >= 1e4 ? e : Math.max(this._options.minPrecision, e);
		}
		ticks(e = 6) {
			return null === this._rebase() ? p(this._min, this._max, e) : p(this._t(this._min), this._t(this._max), e).map((e) => this._tInv(e));
		}
		snapToTick(e) {
			const t = this._options.minMove;
			return t <= 0 ? e : Math.round(e / t) * t;
		}
		setPriceFormatter(e) {
			this._priceFormatter = e;
		}
		format(e) {
			if (null !== this._rebase()) {
				const t = this.precision(), i = this._t(e);
				if ("indexed-to-100" === this._options.mode) return i.toFixed(t);
				const s = Number(i.toFixed(t));
				return `${s > 0 ? "+" : ""}${(0 === s ? 0 : i).toFixed(t)}%`;
			}
			return null !== this._priceFormatter ? this._priceFormatter(e) : e.toFixed(this.precision());
		}
		clampY(e) {
			return o(e, 0, this._height);
		}
	};
	var w = {
		barSpacing: 8,
		minBarSpacing: 1,
		maxBarSpacing: 80,
		rightOffset: 4
	};
	var x = class {
		constructor(e = {}) {
			Object.defineProperty(this, "_barSpacing", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_rightOffset", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_minBarSpacing", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_maxBarSpacing", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_width", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_baseIndex", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_onChange", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			});
			const t = {
				...w,
				...e
			};
			this._barSpacing = t.barSpacing, this._rightOffset = t.rightOffset, this._minBarSpacing = t.minBarSpacing, this._maxBarSpacing = t.maxBarSpacing;
		}
		setWidth(e) {
			this._width = e;
		}
		get width() {
			return this._width;
		}
		get barSpacing() {
			return this._barSpacing;
		}
		setBarSpacing(e) {
			const t = this.visibleRange();
			this._barSpacing = this.constrainBarSpacing(e), this._notifyChange(t);
		}
		constrainBarSpacing(e) {
			return o(e, this._minBarSpacing, this._maxBarSpacing);
		}
		get rightOffset() {
			return this._rightOffset;
		}
		setRightOffset(e) {
			const t = this.visibleRange();
			this._rightOffset = e, this._notifyChange(t);
		}
		setBaseIndex(e) {
			this._baseIndex = e;
		}
		_rightEdgeIndex() {
			return this._baseIndex + this._rightOffset;
		}
		indexToX(e) {
			return this._width - (this._rightEdgeIndex() - e) * this._barSpacing;
		}
		xToIndex(e) {
			return this._rightEdgeIndex() - (this._width - e) / this._barSpacing;
		}
		visibleRange() {
			const e = this._rightEdgeIndex();
			return {
				from: e - this._width / this._barSpacing,
				to: e
			};
		}
		getVisibleLogicalRange() {
			return this.visibleRange();
		}
		setVisibleLogicalRange(e) {
			if (this._width <= 0) return;
			const t = e.to - e.from;
			if (!(t > 0)) return;
			const i = this.visibleRange();
			this._barSpacing = this.constrainBarSpacing(this._width / t), this._rightOffset = e.to - this._baseIndex, this._onChange?.(i);
		}
		setChangeHandler(e) {
			this._onChange = e;
		}
		_notifyChange(e) {
			const t = this.visibleRange();
			e.from === t.from && e.to === t.to || this._onChange?.(e);
		}
		scrollByPixels(e) {
			this.setRightOffset(this._rightOffset - e / this._barSpacing);
		}
		zoomAtX(e, t) {
			const i = this.visibleRange(), s = this.xToIndex(e), r = this._barSpacing;
			if (this._barSpacing = this.constrainBarSpacing(r * t), this._barSpacing === r) return;
			const n = s + (this._width - e) / this._barSpacing;
			this._rightOffset = n - this._baseIndex, this._notifyChange(i);
		}
		fitContent(e) {
			if (e <= 0 || this._width <= 0) return;
			const t = this.visibleRange();
			this._baseIndex = e - 1, this._rightOffset = w.rightOffset;
			const i = this._width / (e + this._rightOffset);
			this._barSpacing = this.constrainBarSpacing(i), this._notifyChange(t);
		}
	};
	var S = 86400;
	function P(e) {
		return e.sort((e, t) => e - t), e[e.length - 1 >> 1];
	}
	function O(e, t, i) {
		let s = 0;
		for (; s < i;) {
			const r = s + i + 1 >> 1;
			e[r] <= t ? s = r : i = r - 1;
		}
		return s;
	}
	function k(e) {
		const t = e.slots, i = t.length - 1;
		let s = NaN;
		if (i < 4096) try {
			s = e.next();
		} catch {
			s = null;
		}
		null !== s && s > t[i] ? t.push(s) : (e.next = null, null !== s && Number.isNaN(s) && i > 0 && (e.step = (t[i] - t[0]) / i));
	}
	function I(e, t) {
		const i = e.slots;
		for (; i.length <= t && e.next;) k(e);
		const s = i.length - 1;
		return t <= s ? i[t] : i[s] + (t - s) * e.step;
	}
	var M = [];
	function T(e, t, i, s, r) {
		const n = Math.max(0, Math.floor(i)), o = Math.min(e.baseIndex, Math.ceil(s));
		if (o < n || 0 === t.length) return !1;
		const a = e.indexToTime(n), l = e.indexToTime(o);
		if (void 0 === a || void 0 === l) return !1;
		let h = 0, c = t.length;
		for (; h < c;) {
			const e = h + c >> 1;
			t[e].time < a ? h = e + 1 : c = e;
		}
		return r.start = h, r.lastTime = l, !0;
	}
	var C = {
		start: 0,
		lastTime: 0
	};
	function j(e, t, i) {
		const s = e.seriesBars(t);
		if (T(e, s, i, i, C)) for (let t = C.start; t < s.length; t++) {
			const i = s[t];
			if (i.time > C.lastTime) return;
			if (void 0 !== e.timeToIndex(i.time)) return i;
		}
	}
	var A = class {
		constructor() {
			Object.defineProperty(this, "_series", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_sortedTimes", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_indexByTime", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_timeRefs", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_nextId", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 1
			}), Object.defineProperty(this, "_version", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_calendar", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_future", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			});
		}
		setSessionCalendar(e) {
			this._calendar = e, this._future = null;
		}
		get sessionCalendar() {
			return this._calendar;
		}
		createSeries() {
			const e = this._nextId++;
			return this._series.set(e, { bars: [] }), e;
		}
		removeSeries(e) {
			const t = this._series.get(e);
			void 0 !== t && (this._replaceBars(t, []), this._series.delete(e));
		}
		setSeriesData(e, t) {
			const i = this._series.get(e);
			if (void 0 === i) throw new Error(`openalgo-charts: unknown series ${e}`);
			this._replaceBars(i, function(e) {
				let t = !0;
				for (let i = 1; i < e.length && t; i++) t = e[i].time > e[i - 1].time;
				if (t) return e.slice();
				const i = e.slice().sort((e, t) => e.time - t.time);
				let s = 0;
				for (let e = 0; e < i.length; e++) s > 0 && i[e].time === i[s - 1].time ? i[s - 1] = i[e] : i[s++] = i[e];
				return i.length = s, i;
			}(t));
		}
		addBars(e, t) {
			const i = this._series.get(e);
			if (void 0 === i) throw new Error(`openalgo-charts: unknown series ${e}`);
			if (0 === t.length) return;
			const s = /* @__PURE__ */ new Map();
			for (const e of i.bars) s.set(e.time, e);
			for (const e of t) s.set(e.time, e);
			this._replaceBars(i, Array.from(s.values()).sort((e, t) => e.time - t.time));
		}
		update(e, t) {
			const i = this._series.get(e);
			if (void 0 === i) throw new Error(`openalgo-charts: unknown series ${e}`);
			const s = i.bars, r = s[s.length - 1];
			if (void 0 === r || t.time > r.time) {
				s.push(t);
				const e = this._sortedTimes.length, i = e > 0 ? this._sortedTimes[e - 1] : void 0, r = this._retain(t.time);
				return void 0 === i || t.time > i ? (this._appendTime(t.time), "append") : r ? (this._rebuild([t.time], !1), "insert") : "replace";
			}
			if (t.time === r.time) return s[s.length - 1] = t, "replace";
			const n = function(e, t) {
				let i = 0, s = e.length - 1;
				for (; i <= s;) {
					const r = i + s >> 1, n = e[r].time;
					if (n === t) return r;
					if (n < t) i = r + 1;
					else {
						if (!(n > t)) break;
						s = r - 1;
					}
				}
				return e.findIndex((e) => e.time === t);
			}(s, t.time);
			return n >= 0 ? (s[n] = t, "replace") : (this.addBars(e, [t]), "insert");
		}
		_appendTime(e) {
			this._indexByTime.has(e) || (this._indexByTime.set(e, this._sortedTimes.length), this._sortedTimes.push(e), this._version++);
		}
		get length() {
			return this._sortedTimes.length;
		}
		get baseIndex() {
			return this._sortedTimes.length - 1;
		}
		indexToTime(e) {
			return this._sortedTimes[e];
		}
		timeToIndex(e) {
			return this._indexByTime.get(e);
		}
		indexToTimeFloat(e) {
			const t = this._sortedTimes, i = t.length;
			if (0 === i) return NaN;
			if (1 === i) return t[0];
			if (e <= 0) return t[0] + e * (t[1] - t[0]);
			if (e >= i - 1) {
				const t = this._plan(), s = e - (i - 1), r = Math.floor(s), n = I(t, r);
				return s === r ? n : n + (s - r) * (I(t, r + 1) - n);
			}
			const s = Math.floor(e);
			return t[s] + (e - s) * (t[s + 1] - t[s]);
		}
		timeToIndexFloat(e) {
			const t = this._sortedTimes, i = t.length;
			if (0 === i) return NaN;
			if (1 === i) return 0;
			if (e <= t[0]) {
				const i = t[1] - t[0];
				return i > 0 ? (e - t[0]) / i : 0;
			}
			if (e >= t[i - 1]) {
				const t = this._plan(), s = t.slots;
				for (; t.next && s[s.length - 1] <= e;) k(t);
				const r = s.length - 1;
				if (e >= s[r]) return i - 1 + r + (e - s[r]) / t.step;
				const n = O(s, e, r);
				return i - 1 + n + (e - s[n]) / (s[n + 1] - s[n]);
			}
			const s = O(t, e, i - 1);
			return s + (e - t[s]) / (t[s + 1] - t[s]);
		}
		_plan() {
			const e = this._sortedTimes, t = Math.max(0, e.length - 1 - 64);
			let i = this._future;
			if (null !== i && i.version !== this._version && i.tail.length === e.length - t && i.tail.every((i, s) => i === e[t + s]) && (i.version = this._version), null === i || i.version !== this._version) {
				const s = e.slice(t), r = P(function(e) {
					const t = [];
					for (let i = 1; i < e.length; i++) t.push(e[i] - e[i - 1]);
					return t;
				}(s));
				let n = null;
				try {
					this._calendar && (n = function(e, t, i) {
						let s = 0;
						const r = (e) => ++s > 512 ? void 0 : t.sessionFrom(e);
						let n = r(e[0]);
						if (!n) return null;
						const o = [], a = [n.open];
						let l = n.open - e[0];
						for (let t = 1; t < e.length; t++) {
							if (e[t] < n.close) o.push(e[t] - e[t - 1]);
							else if (!(n = r(e[t]))) return null;
							a.push(n.open), l = Math.max(l, n.open - e[t]);
						}
						const h = e[e.length - 1];
						let c = n, d = h;
						if (o.length > 0) {
							const t = P(o);
							if (l >= t) return null;
							const i = (e, i) => {
								const s = ((e - i) % t + t) % t;
								return s > 1e-6 && t - s > 1e-6 ? s - t : 0;
							}, s = /* @__PURE__ */ new Map();
							for (let t = 0; t < e.length; t++) s.set(a[t] % S, i(e[t], a[t]));
							const n = i(h, c.open);
							return () => {
								let e = d + t;
								for (; e >= c.close;) {
									const t = r(c.close);
									if (!t) return null === t ? null : NaN;
									c = t;
									const i = t.open + (s.get(t.open % S) ?? n);
									i > d && (e = i);
								}
								return d = e;
							};
						}
						if (i >= 172800 || l >= S) return null;
						const u = h - c.open;
						return () => {
							for (const e = c.date; c.date === e;) {
								const e = r(c.close);
								if (!e) return null === e ? null : NaN;
								c = e;
							}
							const e = c.open + u;
							return e > d ? d = e : null;
						};
					}(s, this._calendar, r));
				} catch {}
				i = this._future = {
					version: this._version,
					tail: s,
					slots: [s[s.length - 1]],
					next: n,
					step: r
				};
			}
			return i;
		}
		seriesBars(e) {
			return this._series.get(e)?.bars ?? M;
		}
		indexedBars(e) {
			const t = this._series.get(e);
			if (void 0 === t) return [];
			const i = [];
			for (const e of t.bars) {
				const t = this._indexByTime.get(e.time);
				void 0 !== t && i.push({
					index: t,
					bar: e
				});
			}
			return i;
		}
		visibleBars(e, t, i) {
			const s = this._series.get(e);
			if (void 0 === s) return [];
			const r = s.bars;
			if (!T(this, r, t, i, C)) return [];
			const n = [];
			for (let e = C.start; e < r.length; e++) {
				const t = r[e].time;
				if (t > C.lastTime) break;
				const i = this._indexByTime.get(t);
				void 0 !== i && n.push({
					index: i,
					bar: r[e]
				});
			}
			return n;
		}
		lastIndexedBar(e) {
			const t = this._series.get(e);
			if (void 0 === t || 0 === t.bars.length) return null;
			const i = t.bars[t.bars.length - 1], s = this._indexByTime.get(i.time);
			return void 0 === s ? null : {
				index: s,
				bar: i
			};
		}
		_retain(e) {
			const t = this._timeRefs.get(e) ?? 0;
			return this._timeRefs.set(e, t + 1), 0 === t;
		}
		_replaceBars(e, t) {
			const i = e.bars;
			e.bars = t;
			let s = 0;
			for (; s < i.length && s < t.length && i[s].time === t[s].time;) s++;
			let r = null;
			for (let e = s; e < t.length; e++) this._retain(t[e].time) && (r ?? (r = [])).push(t[e].time);
			let n = !1;
			for (let e = s; e < i.length; e++) {
				const t = i[e].time, s = this._timeRefs.get(t) ?? 0;
				s <= 1 ? (this._timeRefs.delete(t), n = !0) : this._timeRefs.set(t, s - 1);
			}
			if (null === r && !n) return;
			const o = this._sortedTimes.length > 0 ? this._sortedTimes[this._sortedTimes.length - 1] : -1 / 0;
			if (!n && null !== r && r[0] > o) for (const e of r) this._appendTime(e);
			else this._rebuild(r ?? [], n);
		}
		_rebuild(e = [], t = !0) {
			const i = this._sortedTimes;
			if (e.some(Number.isNaN) || i.some(Number.isNaN)) {
				const e = Array.from(this._timeRefs.keys()).sort((e, t) => e - t);
				this._indexByTime.clear();
				for (let t = 0; t < e.length; t++) this._indexByTime.set(e[t], t);
				this._sortedTimes = e, this._version++;
				return;
			}
			const s = [];
			let r = 0, n = 0;
			for (; r < i.length || n < e.length;) if (n >= e.length || r < i.length && i[r] < e[n]) {
				const e = i[r++];
				!t || this._timeRefs.has(e) ? s.push(e) : this._indexByTime.delete(e);
			} else s.push(e[n++]);
			let o = 0;
			for (; o < s.length && o < i.length && s[o] === i[o];) o++;
			for (let e = o; e < s.length; e++) this._indexByTime.set(s[e], e);
			this._sortedTimes = s, this._version++;
		}
	};
	function L(e) {
		return "string" == typeof e && ("right" === e || "left" === e || "" === e || e.startsWith("overlay:"));
	}
	var N = [
		"left",
		"right",
		"hidden"
	];
	function R(e) {
		return "left" === e || "right" === e ? e : "hidden";
	}
	var F = class {
		constructor() {
			Object.defineProperty(this, "_configured", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Set()
			}), Object.defineProperty(this, "_placements", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map([["right", {
					side: "right",
					order: 0
				}]])
			});
		}
		register(e) {
			L(e) && !this._placements.has(e) && this._placements.set(e, this.get(e));
		}
		get(e) {
			const t = this._placements.get(e);
			if (t) return { ...t };
			const i = R(e);
			let s = 0;
			for (const e of this._placements.values()) e.side === i && s++;
			return {
				side: i,
				order: s
			};
		}
		set(e, t, i) {
			if (!L(e) || !N.includes(t) || void 0 !== i && (!Number.isSafeInteger(i) || i < 0)) return !1;
			const s = this.get(e), r = this._sideIds(t).filter((t) => t !== e), n = Math.min(i ?? (s.side === t ? s.order : r.length), r.length);
			return (s.side !== t || s.order !== n) && (this.register(e), r.splice(n, 0, e), s.side !== t && this._reorder(s.side, this._sideIds(s.side).filter((t) => t !== e)), this._reorder(t, r), !0);
		}
		entries() {
			return Array.from(this._placements, ([e, t]) => ({
				scaleId: e,
				...t
			}));
		}
		configured(e) {
			return this._configured.has(e);
		}
		restore(e) {
			this._configured.clear();
			for (const t of e.keys()) this._configured.add(t);
			for (const t of e.keys()) this.register(t);
			const t = {
				left: 0,
				right: 0,
				hidden: 0
			};
			for (const i of this._placements.keys()) {
				const s = R(i), r = {
					side: s,
					order: t[s]++
				};
				this._placements.set(i, { ...e.get(i) ?? r });
			}
			for (const e of N) this._reorder(e, this._sideIds(e));
		}
		_sideIds(e) {
			return this.entries().filter((t) => t.side === e).sort((e, t) => e.order - t.order).map((e) => e.scaleId);
		}
		_reorder(e, t) {
			t.forEach((t, i) => {
				const s = this._placements.get(t);
				s?.side === e && s.order === i || this._configured.add(t), this._placements.set(t, {
					side: e,
					order: i
				});
			});
		}
	};
	function z(e, t) {
		return "dashed" === e ? [4 * t, 4 * t] : "dotted" === e ? [1 * t, 3 * t] : [];
	}
	function E(e, t, i) {
		const s = z(e.gridStyle, i);
		return {
			color: e.grid,
			lineWidth: t?.lineWidth ?? 1,
			dash: s,
			vert: {
				color: t?.vertColor ?? e.grid,
				dash: void 0 === t?.vertStyle ? s : z(t.vertStyle, i)
			},
			horz: {
				color: t?.horzColor ?? e.grid,
				dash: void 0 === t?.horzStyle ? s : z(t.horzStyle, i)
			}
		};
	}
	function B(e, t, i, s, r, n, o, a) {
		if (0 !== t.length) {
			e.strokeStyle = s?.color ?? r.color, e.setLineDash(s?.dash ?? r.dash ?? []), e.beginPath();
			for (const s of t) {
				const t = Math.round(c(s, n) * n);
				i ? (e.moveTo(t, 0), e.lineTo(t, a)) : (e.moveTo(0, t), e.lineTo(o, t));
			}
			e.stroke();
		}
	}
	function W(e, t) {
		const i = void 0 === t?.fontSize ? e.axisFontSize ?? 11 : o(Math.round(t.fontSize), 10, 14);
		return {
			textColor: t?.textColor ?? e.axisText,
			lineColor: t?.lineColor ?? e.axisLine,
			font: `${i}px system-ui, sans-serif`
		};
	}
	function q(e) {
		const t = {};
		return void 0 !== e?.top && (t.marginTop = o(e.top, 0, 49) / 100), void 0 !== e?.bottom && (t.marginBottom = o(e.bottom, 0, 49) / 100), t;
	}
	var V = {
		upColor: "#26a69a",
		downColor: "#ef5350",
		borderUpColor: "#26a69a",
		borderDownColor: "#ef5350",
		wickUpColor: "#26a69a",
		wickDownColor: "#ef5350",
		borderVisible: !0,
		wickVisible: !0
	};
	function H(e, t, i = {}) {
		return {
			...V,
			upColor: e.upColor ?? t.upColor,
			downColor: e.downColor ?? t.downColor,
			borderUpColor: e.borderUpColor ?? t.upColor,
			borderDownColor: e.borderDownColor ?? t.downColor,
			wickUpColor: e.wickUpColor ?? t.wickUpColor,
			wickDownColor: e.wickDownColor ?? t.wickDownColor,
			borderVisible: e.borderVisible ?? V.borderVisible,
			bodyVisible: e.bodyVisible ?? !0,
			wickVisible: e.wickVisible ?? V.wickVisible,
			colorByPreviousClose: e.colorByPreviousClose,
			...i
		};
	}
	function G(e, t) {
		const i = Math.floor(e * t * .8);
		let s = Math.max(1, i);
		if (s >= 2) s % 2 != Math.max(1, Math.floor(t)) % 2 && (s -= 1);
		return Math.max(1, s);
	}
	function U(e, t, i) {
		return i.wickVisible ? !0 === i.hollow || !1 === i.bodyVisible || e > t || i.borderVisible && e >= 3 || i.upColor !== i.wickUpColor || i.downColor !== i.wickDownColor ? "full" : "wick" : "full";
	}
	function Y(e, t) {
		const i = Math.max(.05, Math.min(1, t));
		return 1 === i ? e : Math.max(1, Math.round(e * i));
	}
	function X(e, t, i, s, r, n = V) {
		const o = G(s, r), a = Math.max(1, Math.floor(r)), l = n.widthScale ? null : U(o, a, n);
		for (let s = 0; s < t.length; s++) {
			const { x: h, bar: c } = t[s], d = s > 0 ? t[s - 1].bar.close : t[s].prevClose, u = !0 === n.colorByPreviousClose && void 0 !== d && Number.isFinite(d) ? c.close >= d : c.close >= c.open, _ = Math.round(i(c.open) * r), p = Math.round(i(c.close) * r), f = Math.round(i(c.high) * r), m = Math.round(i(c.low) * r), b = Math.round(h * r), g = n.widthScale ? Y(o, n.widthScale(c)) : o, v = Math.floor(g / 2), y = c.color, w = y ?? (u ? n.upColor : n.downColor), x = c.wickColor ?? y ?? (u ? n.wickUpColor : n.wickDownColor), S = c.borderColor ?? y ?? (u ? n.borderUpColor : n.borderDownColor);
			if (n.wickVisible && (e.fillStyle = x, e.fillRect(b - (a >> 1), f, a, Math.max(1, m - f))), "wick" === (l ?? U(g, a, n)) && x === w) continue;
			const P = Math.min(_, p), O = Math.max(1, Math.abs(p - _));
			if (n.hollow && u) e.strokeStyle = n.borderVisible ? S : w, e.lineWidth = Math.max(1, a), e.strokeRect(b - v + .5, P + .5, g - 1, O - 1);
			else {
				const t = !1 !== n.bodyVisible;
				t && (e.fillStyle = w, e.fillRect(b - v, P, g, O)), n.borderVisible && (!t || g >= 3) && (e.strokeStyle = S, e.lineWidth = 1, e.strokeRect(b - v + .5, P + .5, g - 1, O - 1));
			}
		}
	}
	function J(e, t, i, s, r, n, o = !1) {
		const a = Math.max(1, Math.floor(G(s, r) / 2)), l = Math.max(1, Math.floor(r));
		e.save();
		for (let s = 0; s < t.length; s++) {
			const h = t[s], c = h.bar, d = Math.round(h.x * r), u = Math.round(i(c.open) * r), _ = Math.round(i(c.close) * r), p = Math.round(i(c.high) * r), f = Math.round(i(c.low) * r), m = s > 0 ? t[s - 1].bar.close : h.prevClose, b = !0 === n.colorByPreviousClose && void 0 !== m && Number.isFinite(m) ? h.bar.close >= m : c.close >= c.open;
			e.fillStyle = h.bar.color ?? (b ? n.upColor ?? "#26a69a" : n.downColor ?? "#ef5350"), e.fillRect(d - Math.floor(l / 2), p, l, Math.max(1, f - p)), o || (e.fillRect(d - a, u, a, l), e.fillRect(d, _, a, l));
		}
		e.restore();
	}
	function Z(e) {
		const t = e.trim();
		if (t.startsWith("#")) {
			const e = t.slice(1);
			if (3 === e.length || 4 === e.length) {
				const [t, i, s, r] = [...e].map((e) => parseInt(e + e, 16));
				return [
					t,
					i,
					s
				].some(Number.isNaN) ? null : {
					r: t,
					g: i,
					b: s,
					a: 4 === e.length ? r / 255 : 1
				};
			}
			if (6 === e.length || 8 === e.length) {
				const t = parseInt(e.slice(0, 6), 16);
				if (Number.isNaN(t)) return null;
				const i = 8 === e.length ? parseInt(e.slice(6, 8), 16) / 255 : 1;
				return {
					r: t >> 16 & 255,
					g: t >> 8 & 255,
					b: 255 & t,
					a: Number.isNaN(i) ? 1 : i
				};
			}
			return null;
		}
		const i = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(t);
		return null === i ? null : {
			r: Number(i[1]),
			g: Number(i[2]),
			b: Number(i[3]),
			a: void 0 === i[4] ? 1 : Number(i[4])
		};
	}
	function Q(e) {
		const t = Z(e);
		return (null !== t ? te(t) : .5) > .45 ? "#10131a" : "#ffffff";
	}
	var ee = (e) => {
		const t = e / 255;
		return t <= .03928 ? t / 12.92 : Math.pow((t + .055) / 1.055, 2.4);
	};
	function te(e) {
		return .2126 * ee(e.r) + .7152 * ee(e.g) + .0722 * ee(e.b);
	}
	function ie(e, t) {
		const i = Z(e);
		return null === i ? e : `rgba(${i.r},${i.g},${i.b},${t})`;
	}
	function se(e) {
		if ("transparent" === e.trim().toLowerCase()) return !0;
		const t = Z(e);
		return null !== t && t.a <= 0;
	}
	function re(e, t) {
		const i = Z(e);
		if (null === i) return e;
		const s = t >= 0 ? 255 : 0, r = Math.min(1, Math.abs(t)), n = (e) => Math.round(e + (s - e) * r);
		return `rgba(${n(i.r)},${n(i.g)},${n(i.b)},${i.a})`;
	}
	function ne(e, t, i, s, r, n) {
		const o = e.roundRect;
		"function" == typeof o ? o.call(e, t, i, s, r, Math.max(0, Math.min(n, s / 2, r / 2))) : e.rect(t, i, s, r);
	}
	var oe = /* @__PURE__ */ new WeakMap();
	function ae(e, t, i, s) {
		let r = oe.get(e);
		void 0 === r && (r = /* @__PURE__ */ new Map(), oe.set(e, r));
		const n = `${Math.round(t)}|${i}|${s}`;
		let o = r.get(n);
		return void 0 === o && (o = e.createLinearGradient(0, 0, 0, t), o.addColorStop(0, i), o.addColorStop(1, s), r.set(n, o)), o;
	}
	var he = {
		xs: [],
		ys: [],
		s: 0,
		n: 0,
		a: -1,
		b: -1
	};
	var ce = {
		xs: [],
		ys: [],
		s: 0,
		n: 0,
		a: -1,
		b: -1
	};
	var de = {
		xs: [],
		ys: [],
		s: 0,
		n: 0,
		a: -1,
		b: -1
	};
	var ue = {
		xs: [],
		ys: [],
		s: 0,
		n: 0,
		a: -1,
		b: -1
	};
	var _e = [];
	function pe(e, t) {
		e.s = 0, e.a = e.b = -1, e.n = t, e.xs.length > 16384 && 4 * t < e.xs.length && (e.xs.length = e.ys.length = t);
	}
	function fe(e, t, i, s) {
		const r = e.xs, n = e.ys;
		for (let e = 0; e < t.length; e++) {
			const o = t[e], a = o.bar;
			r[e] = o.x, n[e] = i(0 === s ? a.close : 1 === s ? a.high : a.low);
		}
		pe(e, t.length);
	}
	function me(e, t, i, s, r) {
		const n = t.length;
		if (0 === n) return;
		const o = t[0].edgeX, a = t[n - 1].edgeX;
		if (void 0 === o && void 0 === a) return;
		if (1 === n) return void (e.n = 0);
		const l = e.xs, h = e.ys;
		if (void 0 !== o) {
			const t = o - r, n = l[1], a = h[1], c = l[0], d = h[0];
			if (n < t || !Number.isFinite(d) || !Number.isFinite(a)) e.s = i ? 2 : 1, h[0] = NaN;
			else {
				const r = Math.hypot(c - n, d - a);
				let o = c < t ? r * (n - t) / (n - c) : r;
				const u = i && Number.isFinite(h[2]), _ = u ? Math.abs(h[2] - a) : 0;
				if (s > 0 && (o = Math.ceil((o + _) / s) * s - _), o !== r) {
					const e = o / r;
					l[0] = n + (c - n) * e, h[0] = a + (d - a) * e;
				}
				e.a = u ? 2 : 1;
			}
		}
		if (void 0 !== a) {
			const t = a + r, s = i ? e.n - 2 : e.n - 1, n = l[s - 1], o = h[s - 1], c = l[s], d = h[s];
			n > t || !Number.isFinite(o) || !Number.isFinite(d) ? (e.n = s, h[s] = NaN) : (c > t && (h[s] = o + (t - n) / (c - n) * (d - o), l[s] = t, e.n = s + 1), e.b = s - 1);
		}
	}
	function be(e, t) {
		return "dashed" === e ? [6 * t, 4 * t] : "dotted" === e ? [1 * t, 3 * t] : [];
	}
	function ge(e, t, i, s, r = !1) {
		const n = t.n, o = t.xs, a = t.ys, l = t.a, h = t.b < 0 ? -1 : t.b + 1;
		if (n <= t.s) return;
		const c = e.strokeStyle;
		e.beginPath();
		let d, u = -1, _ = !1, p = 0;
		for (let f = t.s; f < n; f++) {
			const t = o[f], n = a[f];
			if (!Number.isFinite(t) || !Number.isFinite(n)) {
				u = -1;
				continue;
			}
			if (u < 0) {
				e.moveTo(t * i, n * i), u = f, p = 0;
				continue;
			}
			const m = void 0 === s ? d : s[f];
			m !== d && (_ && (e.stroke(), e.beginPath(), e.moveTo(o[u] * i, a[u] * i), _ = !1, p = 0), e.strokeStyle = m ?? c, d = m), r && _ && f === h && (e.stroke(), e.beginPath(), e.moveTo(o[u] * i, a[u] * i), e.lineDashOffset = p * i, _ = !1), e.lineTo(t * i, n * i), r && (p += Math.hypot(t - o[u], n - a[u])), u = f, _ = !0, r && f === l && (e.stroke(), e.beginPath(), e.moveTo(t * i, n * i), _ = !1, p = 0);
		}
		e.stroke();
	}
	function ve(e, t, i, s, r) {
		const n = he;
		fe(n, t, i, 0);
		let o = n;
		r.step && function(e, t) {
			const i = e.xs, s = e.ys, r = t.xs, n = t.ys;
			let o = 0;
			for (let t = 0; t < e.n; t++) t > 0 && (r[o] = i[t], n[o++] = s[t - 1]), r[o] = i[t], n[o++] = s[t];
			pe(t, o);
		}(n, o = ce);
		const a = function(e, t) {
			let i = !1;
			for (let t = 0; t < e.length; t++) if (void 0 !== e[t].bar.color) {
				i = !0;
				break;
			}
			if (!i) return;
			let s = 0;
			for (let i = 0; i < e.length; i++) {
				const r = e[i].bar.color;
				t && s > 0 && (_e[s++] = r), _e[s++] = r;
			}
			return _e.length = s, _e;
		}(t, !0 === r.step), l = r.lineWidth ?? 1.5, h = be(r.lineStyle, s);
		if (me(o, t, !0 === r.step, function(e, t) {
			let i = 0;
			for (let t = 0; t < e.length; t++) i += e[t];
			return i > 0 ? (e.length % 2 == 1 ? 2 * i : i) / t : 0;
		}(h, s), 8 + l), e.save(), e.strokeStyle = r.color ?? "#4f8cff", e.lineWidth = Math.max(1, l * s), e.lineJoin = "round", e.lineCap = "round", e.setLineDash(h), r.markersOnly || ge(e, o, s, a, h.length > 0), e.setLineDash([]), r.markers || r.markersOnly) {
			const i = (r.markerRadius ?? 2) * s, o = r.color ?? "#4f8cff";
			e.fillStyle = o;
			for (let r = 0; r < t.length; r++) {
				const l = n.xs[r], h = n.ys[r];
				Number.isFinite(l) && Number.isFinite(h) && void 0 === t[r].edgeX && (void 0 !== a && (e.fillStyle = t[r].bar.color ?? o), e.beginPath(), e.arc(l * s, h * s, i, 0, 2 * Math.PI), e.fill());
			}
		}
		e.restore();
	}
	var ye = "rgba(79,140,255,0.15)";
	function we(e, t, i, s, r) {
		void 0 !== i && (e.save(), e.strokeStyle = i, e.lineWidth = Math.max(1, Math.round((s.lineWidth ?? 1.5) * r)), ge(e, t, r), e.restore());
	}
	var xe = {
		color: "#3a4666",
		base: 0
	};
	function Se(e, t) {
		return {
			...e,
			upColor: e.upColor ?? t.upColor,
			downColor: e.downColor ?? t.downColor
		};
	}
	function Pe(e, t, i) {
		return {
			...e,
			color: e.color ?? t.lineColor,
			...i
		};
	}
	var Oe = (e) => ({
		min: e.low,
		max: e.high
	});
	var ke = (e) => ({
		min: e.close,
		max: e.close
	});
	var Ie = (e, t) => {
		const i = t.base ?? 0;
		return {
			min: Math.min(i, e.close),
			max: Math.max(i, e.close)
		};
	};
	var Me = /* @__PURE__ */ new Map();
	var Te = /* @__PURE__ */ new Set(["point-figure", "kagi"]);
	function Ce(e, t) {
		Me.set(e, t);
	}
	function je(e) {
		const t = Me.get(e);
		if (void 0 === t) {
			if (Te.has(e)) throw new Error(`openalgo-charts: series type "${e}" needs the transform tier, import 'openalgo-charts/transform' first`);
			throw new Error(`openalgo-charts: unknown series type "${e}"`);
		}
		return t;
	}
	function Ae() {
		return Array.from(Me.keys());
	}
	Ce("candlestick", {
		defaultStyle: {},
		isPriceSeries: !0,
		draw: (e, t, i, s, r, n, o) => X(e, t, i, s, r, H(n, o.theme)),
		extents: Oe
	}), Ce("hollow-candle", {
		defaultStyle: {},
		isPriceSeries: !0,
		draw: (e, t, i, s, r, n, o) => X(e, t, i, s, r, H(n, o.theme, { hollow: !0 })),
		extents: Oe
	}), Ce("volume-candle", {
		defaultStyle: {},
		isPriceSeries: !0,
		draw: (e, t, i, s, r, n, o) => {
			const a = o.maxVolume;
			X(e, t, i, s, r, H(n, o.theme, { widthScale: (e) => a > 0 ? (e.volume ?? 0) / a : 1 }));
		},
		extents: Oe
	}), Ce("bar", {
		defaultStyle: {},
		isPriceSeries: !0,
		draw: (e, t, i, s, r, n, o) => J(e, t, i, s, r, Se(n, o.theme)),
		extents: Oe
	}), Ce("high-low", {
		defaultStyle: {},
		isPriceSeries: !0,
		draw: (e, t, i, s, r, n, o) => J(e, t, i, s, r, Se(n, o.theme), !0),
		extents: Oe
	}), Ce("line", {
		defaultStyle: { lineWidth: 1.5 },
		isPriceSeries: !0,
		connectsBars: !0,
		draw: (e, t, i, s, r, n, o) => ve(e, t, i, r, Pe(n, o.theme)),
		extents: ke
	}), Ce("line-markers", {
		defaultStyle: {
			lineWidth: 1.5,
			markers: !0
		},
		isPriceSeries: !0,
		connectsBars: !0,
		draw: (e, t, i, s, r, n, o) => ve(e, t, i, r, Pe(n, o.theme, { markers: !0 })),
		extents: ke
	}), Ce("step", {
		defaultStyle: {
			lineWidth: 1.5,
			step: !0
		},
		isPriceSeries: !0,
		connectsBars: !0,
		draw: (e, t, i, s, r, n, o) => ve(e, t, i, r, Pe(n, o.theme, { step: !0 })),
		extents: ke
	}), Ce("area", {
		defaultStyle: { lineWidth: 1.5 },
		isPriceSeries: !0,
		connectsBars: !0,
		draw: (e, t, i, s, r, n, o) => function(e, t, i, s, r, n) {
			const o = he;
			fe(o, t, i, 0), me(o, t, !1, 0, 8 + (n.lineWidth ?? 1.5));
			const a = o.s, l = o.n, h = o.xs, c = o.ys;
			if (l <= a) return;
			const d = r * s;
			e.save(), e.beginPath(), e.moveTo(h[a] * s, d);
			for (let t = a; t < l; t++) e.lineTo(h[t] * s, c[t] * s);
			e.lineTo(h[l - 1] * s, d), e.closePath(), e.fillStyle = ae(e, d, n.areaTopColor ?? "rgba(79,140,255,0.40)", n.areaBottomColor ?? "rgba(79,140,255,0.00)"), e.fill(), e.restore(), ve(e, t, i, s, {
				color: n.color ?? "#4f8cff",
				lineWidth: n.lineWidth ?? 1.5,
				lineStyle: n.lineStyle
			});
		}(e, t, i, r, o.plotHeight, function(e, t) {
			return {
				...e,
				color: e.color ?? t.lineColor,
				areaTopColor: e.areaTopColor ?? t.areaTopColor,
				areaBottomColor: e.areaBottomColor ?? t.areaBottomColor
			};
		}(n, o.theme)),
		extents: ke
	}), Ce("hlc-area", {
		defaultStyle: { lineWidth: 1.5 },
		isPriceSeries: !0,
		connectsBars: !0,
		draw: (e, t, i, s, r, n, o) => function(e, t, i, s, r) {
			if (0 === t.length) return;
			const n = de, o = ue, a = 8 + (r.lineWidth ?? 1.5);
			fe(n, t, i, 1), fe(o, t, i, 2), me(n, t, !1, 0, a), me(o, t, !1, 0, a);
			const l = n.s, h = n.n;
			e.save(), e.beginPath(), h > l && e.moveTo(n.xs[l] * s, n.ys[l] * s);
			for (let t = l; t < h; t++) e.lineTo(n.xs[t] * s, n.ys[t] * s);
			for (let t = o.n - 1; t >= o.s; t--) e.lineTo(o.xs[t] * s, o.ys[t] * s);
			e.closePath(), e.fillStyle = r.areaTopColor ?? ye, e.fill(), e.restore(), we(e, n, r.highColor, r, s), we(e, o, r.lowColor, r, s), ve(e, t, i, s, {
				color: r.closeColor ?? "#4f8cff",
				lineWidth: r.lineWidth ?? 1.5
			});
		}(e, t, i, r, function(e, t) {
			return {
				...e,
				closeColor: e.closeColor ?? t.lineColor
			};
		}(n, o.theme)),
		extents: Oe
	}), Ce("baseline", {
		defaultStyle: {
			baseValue: 0,
			lineWidth: 1.5
		},
		isPriceSeries: !0,
		connectsBars: !0,
		draw: (e, t, i, s, r, n, o) => function(e, t, i, s, r) {
			const n = i(r.baseValue ?? 0) * s, o = he;
			fe(o, t, i, 0), me(o, t, !1, 0, 8 + (r.lineWidth ?? 1.5));
			const a = o.s, l = o.n, h = o.xs, c = o.ys;
			if (l <= a) return;
			const d = h[a] * s, u = h[l - 1] * s, _ = () => {
				e.beginPath(), e.moveTo(d, n);
				for (let t = a; t < l; t++) e.lineTo(h[t] * s, c[t] * s);
				e.lineTo(u, n), e.closePath();
			}, p = r.areaTopColor ?? "rgba(38,166,154,0.20)", f = r.areaBottomColor ?? "rgba(239,83,80,0.20)", m = 1e5;
			e.save(), e.beginPath(), e.rect(d, n - m, u - d, m), e.clip(), _(), e.fillStyle = ae(e, n, p, "rgba(0,0,0,0)"), e.fill(), e.restore(), e.save(), e.beginPath(), e.rect(d, n, u - d, m), e.clip(), _(), e.fillStyle = f, e.fill(), e.restore(), e.save();
			for (let t = a + 1; t < l; t++) {
				const i = c[t - 1], o = c[t];
				e.strokeStyle = (i + o) / 2 <= n / s ? r.topColor ?? "#26a69a" : r.bottomColor ?? "#ef5350", e.lineWidth = Math.max(1, Math.round((r.lineWidth ?? 1.5) * s)), e.beginPath(), e.moveTo(h[t - 1] * s, i * s), e.lineTo(h[t] * s, o * s), e.stroke();
			}
			e.restore();
		}(e, t, i, r, function(e, t) {
			return {
				...e,
				topColor: e.topColor ?? t.baselineTopLine,
				bottomColor: e.bottomColor ?? t.baselineBottomLine,
				areaTopColor: e.areaTopColor ?? t.baselineTopFill,
				areaBottomColor: e.areaBottomColor ?? t.baselineBottomFill
			};
		}(n, o.theme)),
		extents: (e, t) => {
			const i = t.baseValue ?? 0;
			return {
				min: Math.min(i, e.close),
				max: Math.max(i, e.close)
			};
		}
	}), Ce("column", {
		defaultStyle: { base: 0 },
		isPriceSeries: !1,
		draw: (e, t, i, s, r, n, o) => function(e, t, i, s, r, n) {
			const o = G(s, r), a = Math.floor(o / 2), l = Math.round(i(n.base ?? 0) * r);
			e.save();
			for (const s of t) {
				const t = Math.round(s.x * r), h = Math.round(i(s.bar.close) * r), c = s.bar.close >= s.bar.open;
				e.fillStyle = s.bar.color ?? n.color ?? (c ? n.upColor ?? "#26a69a" : n.downColor ?? "#ef5350");
				const d = Math.min(l, h);
				e.fillRect(t - a, d, o, Math.max(1, Math.abs(l - h)));
			}
			e.restore();
		}(e, t, i, s, r, Se(n, o.theme)),
		extents: Ie
	}), Ce("histogram", {
		defaultStyle: {
			base: 0,
			color: xe.color
		},
		isPriceSeries: !1,
		draw: (e, t, i, s, r, n) => {
			(function(e, t, i, s, r, n = xe) {
				const o = G(s, r), a = Math.floor(o / 2), l = Math.round(i(n.base) * r);
				let h = "";
				for (const { x: s, bar: c } of t) {
					const t = c.color ?? n.color;
					t !== h && (e.fillStyle = t, h = t);
					const d = Math.round(s * r), u = Math.round(i(c.close) * r), _ = Math.min(l, u), p = Math.max(1, Math.abs(l - u));
					e.fillRect(d - a, _, o, p);
				}
			})(e, t, i, s, r, {
				color: n.color ?? xe.color,
				base: n.base ?? 0
			});
		},
		extents: Ie
	});
	var ze = /* @__PURE__ */ new Map([
		["candlestick", "ohlc"],
		["hollow-candle", "ohlc"],
		["volume-candle", "ohlc"],
		["bar", "ohlc"],
		["high-low", "ohlc"],
		["hlc-area", "band"],
		["line", "line"],
		["line-markers", "line"],
		["step", "line"],
		["area", "line"],
		["baseline", "line"],
		["column", "column"],
		["histogram", "column"]
	]);
	function Ee(e) {
		return ze.get(e) ?? null;
	}
	function Be(e, t) {
		return "ohlc" === e ? Math.max(1, Math.floor(t)) : 1;
	}
	function $e(e, t = 1, i = "ohlc") {
		const s = Number.isFinite(t) && t > 1 ? t : 1;
		return Math.max(1, Math.round(Be(i, e) * s));
	}
	function De(e) {
		let t = "ohlc", i = 1, s = 1, r = 1, n = NaN;
		const o = [];
		let a, l, h, c, d = 0, u = !1, _ = 0, p = NaN, f = NaN, m = NaN, b = NaN, g = 0, v = !1, y = null, w = 0, x = null, S = 0, P = null, O = 0, k = 0, I = null, M = 0, T = 0, C = 0, j = null, A = 0, L = 0, N = null, R = 0, F = 0, z = 0, E = 0;
		const B = [], $ = [], D = [];
		let W = 0, q = !1;
		const V = (e, t, i) => {
			let s = W;
			for (; s > 0 && B[s - 1] > e;) s--;
			if (!(s > 0 && B[s - 1] === e)) {
				for (let e = W; e > s; e--) B[e] = B[e - 1], $[e] = $[e - 1], D[e] = D[e - 1];
				B[s] = e, $[s] = t, D[s] = i, W++;
			}
		}, H = () => {
			if (null === y) return;
			const i = y;
			if (y = null, "band" === t) {
				W = 0, V(z, w, i), V(k, O, P), V(T, M, I), V(L, A, j), V(F, R, N), V(E, S, x);
				for (let t = 0; t < W; t++) e($[t], D[t]);
				return;
			}
			const s = k <= T, r = s ? P : I, n = s ? O : M, o = s ? I : P, a = s ? M : O;
			if ("column" === t) return e(n, r), void (o !== r && e(a, o));
			e(w, i), r !== i && e(n, r), o !== i && o !== r && e(a, o), x !== i && x !== r && x !== o && e(S, x);
		}, G = () => {
			"ohlc" === t ? (() => {
				if (!u) return;
				u = !1;
				let t = o[d];
				void 0 === t && (t = {
					time: 0,
					open: 0,
					high: 0,
					low: 0,
					close: 0,
					volume: void 0,
					oi: void 0,
					color: void 0,
					wickColor: void 0,
					borderColor: void 0
				}, o.push(t)), d++, t.time = _, t.open = p, t.high = f, t.low = m, t.close = b, t.volume = v ? g : void 0, t.oi = a, t.color = l, t.wickColor = h, t.borderColor = c, e((n * s + (s - r >> 1) + (r >> 1)) / i, t);
			})() : H();
		};
		return {
			begin(e, o, a) {
				t = e, i = o, s = $e(o, a, e), r = Be(e, o), n = NaN, d = 0, u = !1, y = null, q = !1, C = 0;
			},
			push(o, d) {
				const B = Math.floor((Math.round(o * i) - (r >> 1) + (r - 1 >> 1)) / s);
				B !== n && (G(), n = B), "ohlc" === t ? ((e) => {
					if (!Number.isFinite(e.close)) return;
					const t = e.high, i = e.low;
					u ? (t != t || f >= t || (f = t), i != i || m <= i || (m = i)) : (u = !0, _ = e.time, p = e.open, f = t, m = i, g = 0, v = !1, a = void 0), b = e.close, void 0 !== e.volume && (g += e.volume, v = !0), void 0 !== e.oi && (a = e.oi), l = e.color, h = e.wickColor, c = e.borderColor;
				})(d) : ((i, s) => {
					const r = s.close;
					if (!Number.isFinite(r)) {
						if ("column" === t) return;
						H(), q || (q = !0, e(i, s));
						return;
					}
					q = !1;
					const n = C++;
					if (null === y) y = s, w = i, z = n, P = s, O = i, k = n, I = s, M = i, T = n, j = s, A = i, L = n, N = s, R = i, F = n;
					else if (r < P.close && (P = s, O = i, k = n), r > I.close && (I = s, M = i, T = n), "band" === t) {
						const e = s.high, t = s.low;
						e != e || j.high >= e || (j = s, A = i, L = n), t != t || N.low <= t || (N = s, R = i, F = n);
					}
					x = s, S = i, E = n;
				})(o, d);
			},
			end() {
				G(), n = NaN;
			}
		};
	}
	var We = {
		time: 0,
		open: NaN,
		high: NaN,
		low: NaN,
		close: NaN
	};
	var qe = {
		start: 0,
		lastTime: 0
	};
	function Ve() {
		const e = [], t = [];
		let i = 0, s = -1, r = null;
		const n = (s, r) => {
			const n = i++;
			let o = t[n];
			void 0 === o && (o = {
				x: 0,
				bar: We,
				prevClose: void 0,
				edgeX: void 0
			}, t.push(o)), o.x = s, o.bar = r, o.prevClose = void 0, o.edgeX = void 0, e[n] = o;
		}, o = (t, s, r, o, a) => {
			const l = t.timeToIndex(s.time);
			void 0 !== l && (n(o.indexToX(l + r), s), e[i - 1].edgeX = a);
		}, a = De(n);
		return {
			items: e,
			priceToY: (e) => r.priceToY(e),
			firstIndex: () => s,
			build(l, h, c, d, u, _, p, f, m = !1) {
				r = p, i = 0, s = -1;
				const b = l.seriesBars(h);
				if (T(l, b, c, d, qe)) {
					const e = qe.lastTime;
					m && qe.start > 0 && o(l, b[qe.start - 1], u, _, 0), null !== f && a.begin(f.kind, f.dpr, f.factor);
					let t = qe.start;
					for (; t < b.length; t++) {
						const i = b[t];
						if (i.time > e) break;
						const r = l.timeToIndex(i.time);
						if (void 0 === r) continue;
						s < 0 && (s = r);
						const o = _.indexToX(r + u);
						null !== f ? a.push(o, i) : n(o, i);
					}
					null !== f && a.end(), m && t < b.length && o(l, b[t], u, _, _.width);
				}
				if (e.length !== i) {
					for (let s = i; s < e.length; s++) t[s].bar = We;
					e.length = i;
				}
				return t.length > 4096 && 4 * i < t.length && (t.length = Math.max(4096, 2 * i)), e;
			}
		};
	}
	var He = {
		left: 1 / 0,
		top: 1 / 0,
		right: -1 / 0,
		bottom: -1 / 0
	};
	var Ge = {
		left: -1 / 0,
		top: -1 / 0,
		right: 1 / 0,
		bottom: 1 / 0
	};
	var Ue = 0;
	function Ke() {
		const e = [], t = [], i = [], s = [], r = [];
		let n = 0, o = 0, a = !1, l = !1, h = !1;
		const c = (e, t) => e.length === t.length && e.every((e, i) => Object.is(e, t[i])), d = (e) => {
			const i = n++;
			Object.is(t[i], e) || (t[i] = e, a = !0);
		};
		return {
			begin() {
				n = 0, o = 0, a = !1, d(Ue);
			},
			number: d,
			ref(e) {
				const t = o++;
				t < i.length && Object.is(i[t], e) || (i[t] = e, a = !0);
			},
			scale(e) {
				d(e.priceToY(1)), d(e.priceToY(1e3)), d(e.height), d(m.indexOf(e.options.mode)), d(e.options.inverted ? 1 : 0);
			},
			end() {
				n !== t.length && (t.length = n, a = !0), o !== i.length && (i.length = o, a = !0), a && (e.length = 0, h = !1, l = c(t, s) && c(i, r));
			},
			painted() {
				h && (e.length = 0, h = !1), s.length = 0, s.push(...t), r.length = 0, r.push(...i), l = !0;
			},
			kept: (t) => e[t],
			measure(t, i, s) {
				const r = void 0 === i.hitBounds ? Ge : i.hitBounds(s) ?? He;
				return e[t] = r, l || (h = !0), r;
			},
			clear() {
				e.length = 0;
			}
		};
	}
	function Ye(e, t, i) {
		return !(t < e.left || t > e.right || i < e.top || i > e.bottom);
	}
	var Xe = 19800;
	function Qe(e) {
		const t = /* @__PURE__ */ new Date(1e3 * (e + Xe));
		return {
			year: t.getUTCFullYear(),
			month: t.getUTCMonth() + 1,
			day: t.getUTCDate(),
			hour: t.getUTCHours(),
			minute: t.getUTCMinutes(),
			second: t.getUTCSeconds(),
			weekday: t.getUTCDay()
		};
	}
	var et = (e) => e < 10 ? `0${e}` : String(e);
	function tt(e) {
		const t = Qe(e);
		return `${et(t.hour)}:${et(t.minute)}`;
	}
	function it(e) {
		const t = Qe(e);
		return `${et(t.hour)}:${et(t.minute)}:${et(t.second)}`;
	}
	var rt = [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec"
	];
	function nt(e) {
		const t = Qe(e);
		return `${et(t.day)} ${rt[t.month - 1]}`;
	}
	var ot = [
		"Sun",
		"Mon",
		"Tue",
		"Wed",
		"Thu",
		"Fri",
		"Sat"
	];
	var ht = "Asia/Kolkata";
	var ct = /* @__PURE__ */ new Map();
	var dt = {
		Sun: 0,
		Mon: 1,
		Tue: 2,
		Wed: 3,
		Thu: 4,
		Fri: 5,
		Sat: 6
	};
	function ut(e) {
		let t = ct.get(e);
		if (void 0 === t) {
			let i;
			try {
				i = new Intl.DateTimeFormat("en-US", {
					timeZone: e,
					hourCycle: "h23",
					year: "numeric",
					month: "2-digit",
					day: "2-digit",
					hour: "2-digit",
					minute: "2-digit",
					second: "2-digit",
					weekday: "short"
				});
			} catch {
				throw new Error(`openalgo-charts: unknown IANA time zone "${e}"`);
			}
			t = {
				format: i,
				parts: /* @__PURE__ */ new Map(),
				lastSecond: NaN,
				lastParts: null
			}, ct.set(e, t);
		}
		return t;
	}
	function _t(e) {
		if (ct.has(e)) return !0;
		try {
			return ut(e), !0;
		} catch {
			return !1;
		}
	}
	function pt(e, t) {
		const i = ut(t);
		if (e === i.lastSecond && null !== i.lastParts) return i.lastParts;
		let s = i.parts.get(e);
		return void 0 === s && (s = function(e, t) {
			let i = 1970, s = 1, r = 1, n = 0, o = 0, a = 0, l = 4;
			for (const h of e.formatToParts(/* @__PURE__ */ new Date(1e3 * t))) switch (h.type) {
				case "year":
					i = Number(h.value);
					break;
				case "month":
					s = Number(h.value);
					break;
				case "day":
					r = Number(h.value);
					break;
				case "hour":
					n = Number(h.value) % 24;
					break;
				case "minute":
					o = Number(h.value);
					break;
				case "second":
					a = Number(h.value);
					break;
				case "weekday": l = dt[h.value] ?? 0;
			}
			return {
				year: i,
				month: s,
				day: r,
				hour: n,
				minute: o,
				second: a,
				weekday: l,
				dayIndex: Math.floor(Date.UTC(i, s - 1, r) / 864e5)
			};
		}(i.format, e), i.parts.size >= 4096 && i.parts.clear(), i.parts.set(e, s)), i.lastSecond = e, i.lastParts = s, s;
	}
	function ft(e, t = ht) {
		const i = pt(e, t);
		return {
			year: i.year,
			month: i.month,
			day: i.day,
			hour: i.hour,
			minute: i.minute,
			second: i.second,
			weekday: i.weekday
		};
	}
	function gt(e, t = ht) {
		const i = pt(e, t);
		return Math.floor(Date.UTC(i.year, i.month - 1, i.day, i.hour, i.minute, i.second) / 1e3) - e;
	}
	function vt(e, t, i = ht) {
		return pt(e, i).dayIndex !== pt(t, i).dayIndex;
	}
	function wt(e, t, i = ht) {
		const s = pt(e, i), r = pt(t, i);
		return s.year !== r.year || s.month !== r.month;
	}
	function St(e, t, i = ht) {
		return pt(e, i).year !== pt(t, i).year;
	}
	function kt(e, t, i, s = 0, r = 0, n = 0, o = ht) {
		const a = Math.floor(Date.UTC(e, t - 1, i, s, r, n) / 1e3);
		return a - gt(a - gt(a, o), o);
	}
	function Ct(e, t = ht) {
		const i = pt(e, t);
		return `${et(i.hour)}:${et(i.minute)}`;
	}
	function jt(e, t = ht) {
		const i = pt(e, t);
		return `${et(i.hour)}:${et(i.minute)}:${et(i.second)}`;
	}
	function At(e, t = ht) {
		const i = pt(e, t);
		return `${et(i.day)} ${rt[i.month - 1]}`;
	}
	function Nt(e, t = ht) {
		const i = pt(e, t);
		let s = `${ot[i.weekday]} ${et(i.day)} ${rt[i.month - 1]} '${String(i.year).slice(-2)}`;
		return 0 === i.hour && 0 === i.minute && 0 === i.second || (s += ` ${et(i.hour)}:${et(i.minute)}`, 0 !== i.second && (s += `:${et(i.second)}`)), s;
	}
	var Et = /^\s*(\d{2})(\d{2})\s*-\s*(\d{2})(\d{2})(?:\s*:\s*([1-7]+))?\s*$/;
	function Bt(e, t) {
		const i = Number(e), s = Number(t);
		return i > 23 || s > 59 ? -1 : 60 * i + s;
	}
	function $t(e) {
		const t = Et.exec(e);
		if (null === t) return null;
		const i = Bt(t[1], t[2]), s = Bt(t[3], t[4]);
		return i < 0 || s < 0 ? null : void 0 === t[5] ? {
			start: i,
			end: s
		} : {
			start: i,
			end: s,
			days: [...t[5]].map(Number)
		};
	}
	var Vt = {
		textColor: "#8b91a7",
		lineColor: "#2a3046",
		font: "11px system-ui, sans-serif"
	};
	var Ht = 90;
	var Gt = 30;
	var Ut = 10;
	function Kt(e, t = 0) {
		const i = new Array(e.length).fill(!1), s = e.map((e, t) => t);
		s.sort((t, i) => e[i].priority - e[t].priority || t - i);
		const r = [];
		for (const n of s) {
			const s = e[n];
			if (!Number.isFinite(s.y) || !Number.isFinite(s.height)) continue;
			let o = !0;
			for (const e of r) if (Math.abs(e.y - s.y) < (e.height + s.height) / 2 + t) {
				o = !1;
				break;
			}
			o && (i[n] = !0, r.push(s));
		}
		return i;
	}
	function Yt(e, t, i) {
		const s = 8 * i;
		return e >= s && e <= t - s;
	}
	function Xt(e, t, i, s, r = Vt, n, o = "right") {
		const a = t.ticks((l = i.plotHeight, !Number.isFinite(l) || l <= 0 ? 2 : Math.max(2, Math.min(30, Math.round(l / 32)))));
		var l;
		const h = function(e, t, i, s) {
			return void 0 === s || 0 === s.length ? null : Kt([...e.map((e) => ({
				y: Math.round(t.priceToY(e) * i),
				height: 16 * i,
				priority: Ut
			})), ...s], 2 * i).slice(0, e.length);
		}(a, t, s, n), c = "left" === o, d = Math.round((c ? i.plotLeft : i.plotWidth) * s), u = c ? d - .5 : d + .5, _ = c ? d - 6 * s : d + 6 * s;
		e.save(), e.strokeStyle = r.lineColor, e.fillStyle = r.textColor, e.font = _i(r.font, s), e.textAlign = c ? "right" : "left", e.textBaseline = "middle", e.lineWidth = 1, e.beginPath(), e.moveTo(u, 0), e.lineTo(u, Math.round(i.plotHeight * s)), e.stroke();
		for (let r = 0; r < a.length; r++) {
			if (null !== h && !h[r]) continue;
			const n = a[r], o = Math.round(t.priceToY(n) * s);
			Yt(o, i.plotHeight * s, s) && e.fillText(t.format(n), _, o);
		}
		e.restore();
	}
	function Jt(e, t, i, s) {
		const r = s ? "timeWithSeconds" : "time";
		if (i === "Asia/Kolkata") {
			const i = Qe(e), s = Qe(t);
			return i.year !== s.year ? "year" : i.month !== s.month ? "month" : i.day !== s.day ? "day" : r;
		}
		return St(e, t, i) ? "year" : wt(e, t, i) ? "month" : vt(e, t, i) ? "day" : r;
	}
	function Zt(e, t) {
		const i = Qt(e);
		return i != i || i !== Qt(t);
	}
	function Qt(e) {
		const t = Math.trunc(1e3 * (e + Xe));
		return Math.abs(t) <= 864e13 ? Math.floor(t / 864e5) : NaN;
	}
	function ei(e, t, i) {
		const s = [];
		for (let r = e; r <= t; r += i) s.push(r);
		return s;
	}
	var ti = {
		up: "#26a69a",
		down: "#ef5350",
		text: "#0d0e12"
	};
	function ii(e, t = 64) {
		const i = e.baseIndex, s = [];
		let r;
		for (let n = Math.max(0, i - t); n <= i; n++) {
			const t = e.indexToTime(n);
			void 0 !== t && (void 0 !== r && t - r > 0 && s.push(t - r), r = t);
		}
		return 0 === s.length ? 0 : (s.sort((e, t) => e - t), s[s.length >> 1]);
	}
	function si(e, t, i) {
		if (!Number.isFinite(t) || t <= 0) return null;
		if (!Number.isFinite(e) || !Number.isFinite(i)) return null;
		const s = i - e;
		return s < 0 ? t - s : t - s % t;
	}
	var ri = (e) => e < 10 ? `0${e}` : String(e);
	function ni(e) {
		if (null === e || !Number.isFinite(e)) return "--:--:--";
		const t = Math.max(0, Math.ceil(e));
		return `${ri(Math.floor(t / 3600))}:${ri(Math.floor(t % 3600 / 60))}:${ri(t % 60)}`;
	}
	function oi(e, t = !1) {
		return (t ? 28 : 16) * e;
	}
	function ai(e, t, i, s) {
		return !Number.isFinite(e) || e < 0 || e > t ? null : "right" === s ? e : t < i ? null : Math.max(i / 2, Math.min(t - i / 2, e));
	}
	function li(e, t, i, s, r, n, o, a) {
		const l = Math.round(r.plotLeft * n) - 1;
		if (!(l > 0)) return;
		const h = Math.min(6 * n, l / 4), c = s.map((t) => (e.font = t.font, e.measureText(t.text).width)), d = Math.min(l, Math.max(...c) + 2 * h), u = -1 - d;
		e.fillStyle = o, e.fillRect(u, t - i / 2, d, i), e.fillStyle = a;
		for (let r = 0; r < s.length; r++) {
			const o = s[r], a = Number(/(^|[^\d.])(\d{1,5}(?:\.\d{1,4})?)px/.exec(o.font)?.[2]), l = a > 0 ? (i / s.length - 2 * n) / a : 1, _ = c[r] > 0 ? (d - 2 * h) / c[r] : 1;
			e.font = _i(o.font, Math.min(1, _, l)), e.fillText(o.text, u + h, t + o.offset);
		}
	}
	function hi(e, t, i, s, r, n, o, a) {
		const l = e.measureText(n).width;
		e.fillStyle = o, e.fillRect(t + 1, i - s / 2, l + 2 * r, s), e.fillStyle = a, e.fillText(n, t + 1 + r, i);
	}
	function ci(e, t, i, s, r, n, o = Vt, a = "right") {
		if (!Number.isFinite(i)) return;
		const l = ai(Math.round(t.priceToY(i) * n), r.plotHeight * n, oi(n), a);
		null !== l && (e.save(), e.font = _i(o.font, n), e.textAlign = "left", e.textBaseline = "middle", "left" === a ? li(e, l, oi(n), [{
			text: t.format(i),
			font: e.font,
			offset: 0
		}], r, n, s, Q(s)) : hi(e, Math.round(r.plotWidth * n), l, oi(n), 6 * n, t.format(i), s, Q(s)), e.restore());
	}
	function di(e, t, i, s, r, n, o = Vt, { colors: a = ti, countdown: l, side: h = "right" } = {}) {
		const c = Math.round(t.priceToY(i) * n);
		if (!Number.isFinite(c) || c < 0 || c > r.plotHeight * n) return;
		const d = s ? a.up : a.down, u = Math.round(r.plotWidth * n);
		e.save();
		const _ = t.format(i), p = void 0 !== l && !0 === l.visible, f = _i(o.font, n);
		e.font = f;
		const m = 6 * n, b = oi(n, p);
		if (e.textAlign = "left", e.textBaseline = "middle", "left" === h) {
			const t = ai(c, r.plotHeight * n, b, h);
			if (null !== t) {
				const i = [{
					text: _,
					font: f,
					offset: p ? -b / 4 : 0
				}];
				p && i.push({
					text: ni(si(l.lastBarTime, l.intervalSec, l.now())),
					font: _i(o.font, .9 * n),
					offset: b / 4
				}), li(e, t, b, i, r, n, d, a.text);
			}
		} else if (p) {
			const t = ni(si(l.lastBarTime, l.intervalSec, l.now())), i = _i(o.font, .9 * n), s = e.measureText(_).width;
			e.font = i;
			const r = e.measureText(t).width;
			e.fillStyle = d, e.fillRect(u + 1, c - b / 2, Math.max(s, r) + 2 * m, b), e.fillStyle = a.text, e.font = f, e.fillText(_, u + 1 + m, c - b / 4), e.font = i, e.fillText(t, u + 1 + m, c + b / 4);
		} else hi(e, u, c, b, m, _, d, a.text);
		e.restore();
	}
	function ui(e, t, i, s, r = Vt) {
		if (!0 !== s.visible) return;
		if (t.timeAxisHeight <= 0 || t.priceAxisWidth <= 0) return;
		const n = s.now();
		if (!Number.isFinite(n)) return;
		const o = Math.floor(n), a = void 0 !== s.timezone && s.timezone !== "Asia/Kolkata" && _t(s.timezone) ? s.timezone : ht, l = a === ht, h = l ? it(o) : jt(o, a), c = l ? Xe : gt(o, a), d = Math.round((t.plotWidth + t.priceAxisWidth / 2) * i), u = Math.round(t.plotHeight * i), _ = t.timeAxisHeight * i, p = !1 !== s.showOffset && t.timeAxisHeight >= 20;
		e.save(), e.fillStyle = r.textColor, e.textAlign = "center", e.textBaseline = "middle", e.font = _i(r.font, i), p ? (e.fillText(h, d, u + .3 * _), e.font = _i(r.font, .82 * i), e.fillText(function(e) {
			const t = Math.round(e / 60);
			if (0 === t) return "UTC";
			const i = Math.abs(t), s = i % 60;
			return `UTC${t < 0 ? "-" : "+"}${Math.floor(i / 60)}${0 === s ? "" : `:${ri(s)}`}`;
		}(c), d, u + .74 * _)) : e.fillText(h, d, u + _ / 2), e.restore();
	}
	function _i(e, t) {
		return e.replace(/(^|[^\d.])(\d{1,5}(?:\.\d{1,4})?)px/, (e, i, s) => `${i}${Number(s) * t}px`);
	}
	function pi(e, t, i) {
		return {
			color: t?.color ?? e.crosshair,
			width: t?.width ?? e.crosshairWidth ?? 1,
			dash: z(t?.style ?? e.crosshairStyle ?? "dashed", i)
		};
	}
	function fi(e, t, i, s, r, n, o, a = 1, l = [4 * n, 4 * n]) {
		if (e.save(), e.strokeStyle = o, e.lineWidth = Math.max(1, a), e.setLineDash(l), t >= 0 && t <= s) {
			const i = Math.round(t * n) + .5;
			e.beginPath(), e.moveTo(i, 0), e.lineTo(i, Math.round(r * n)), e.stroke();
		}
		if (null !== i && i >= 0 && i <= r) {
			const t = Math.round(i * n) + .5;
			e.beginPath(), e.moveTo(0, t), e.lineTo(Math.round(s * n), t), e.stroke();
		}
		e.setLineDash([]), e.restore();
	}
	var mi = "ui-sans-serif, system-ui, sans-serif";
	var bi = {};
	var gi = {};
	function vi(e) {
		const t = e.iconSize;
		return "number" == typeof t && Number.isFinite(t) ? Math.max(12, Math.min(28, t)) : 16;
	}
	function yi(e) {
		return Math.max(18, vi(e) + 2);
	}
	var wi = (e) => e.parts.reduce((e, t) => e + t.w + t.gap, 0);
	function xi(e, t, i) {
		return "ohlc" === t ? !1 !== e.chartValues : "change" === t ? !1 !== e.barChange : "volume" === t ? !1 !== e.volume : "openInterest" === t ? !0 === e.openInterest && !1 !== i : !1 !== e.lastValueLabel;
	}
	var Si = [
		"hide",
		"settings",
		"close"
	];
	function Pi(e, t, i, s, r, n, o) {
		const a = .36 * r * n, l = Math.max(1, Math.round(1.4 * r * n / 16));
		switch (e.save(), e.strokeStyle = e.fillStyle, e.lineWidth = l, e.lineCap = "round", e.lineJoin = "round", e.beginPath(), t) {
			case "up":
				e.moveTo(i, s + a), e.lineTo(i, s - a), e.moveTo(i - .62 * a, s - .35 * a), e.lineTo(i, s - a), e.lineTo(i + .62 * a, s - .35 * a);
				break;
			case "down":
				e.moveTo(i, s - a), e.lineTo(i, s + a), e.moveTo(i - .62 * a, s + .35 * a), e.lineTo(i, s + a), e.lineTo(i + .62 * a, s + .35 * a);
				break;
			case "hide":
				e.moveTo(i - a, s), e.quadraticCurveTo(i, s - 1.15 * a, i + a, s), e.quadraticCurveTo(i, s + 1.15 * a, i - a, s), e.stroke(), e.beginPath(), e.arc(i, s, .34 * a, 0, 2 * Math.PI), !0 === o.hidden && (e.moveTo(i - a, s + .85 * a), e.lineTo(i + a, s - .85 * a));
				break;
			case "maximize":
				!0 === o.maximized ? (e.moveTo(i - a, s - .25 * a), e.lineTo(i - .25 * a, s - .25 * a), e.lineTo(i - .25 * a, s - a), e.moveTo(i + a, s + .25 * a), e.lineTo(i + .25 * a, s + .25 * a), e.lineTo(i + .25 * a, s + a)) : (e.moveTo(i - a, s - .4 * a), e.lineTo(i - a, s - a), e.lineTo(i - .4 * a, s - a), e.moveTo(i + .4 * a, s - a), e.lineTo(i + a, s - a), e.lineTo(i + a, s - .4 * a), e.moveTo(i + a, s + .4 * a), e.lineTo(i + a, s + a), e.lineTo(i + .4 * a, s + a), e.moveTo(i - .4 * a, s + a), e.lineTo(i - a, s + a), e.lineTo(i - a, s + .4 * a));
				break;
			case "collapse": {
				const t = !0 === o.collapsed ? .6 * a : 0;
				e.moveTo(i - a, s - .7 * a), e.lineTo(i + a, s - .7 * a), e.moveTo(i - .6 * a, s + .6 * a - t), e.lineTo(i, s + t), e.lineTo(i + .6 * a, s + .6 * a - t);
				break;
			}
			case "settings":
				e.arc(i, s, .46 * a, 0, 2 * Math.PI);
				for (let t = 0; t < 8; t++) {
					const r = t * Math.PI / 4, n = Math.cos(r), o = Math.sin(r);
					e.moveTo(i + n * a * .68, s + o * a * .68), e.lineTo(i + n * a, s + o * a);
				}
				break;
			case "source": {
				const t = .62 * a, r = .34 * a, n = .28 * a;
				for (const o of [-1, 1]) {
					const l = i + o * t;
					e.moveTo(l - o * r, s - a), e.quadraticCurveTo(l, s - a, l, s - .55 * a), e.lineTo(l, s - .2 * a), e.quadraticCurveTo(l, s, l + o * n, s), e.quadraticCurveTo(l, s, l, s + .2 * a), e.lineTo(l, s + .55 * a), e.quadraticCurveTo(l, s + a, l - o * r, s + a);
				}
				break;
			}
			case "close": e.moveTo(i - .8 * a, s - .55 * a), e.lineTo(i + .8 * a, s - .55 * a), e.moveTo(i - .3 * a, s - .55 * a), e.lineTo(i - .3 * a, s - .85 * a), e.lineTo(i + .3 * a, s - .85 * a), e.lineTo(i + .3 * a, s - .55 * a), e.moveTo(i - .6 * a, s - .55 * a), e.lineTo(i - .45 * a, s + .85 * a), e.lineTo(i + .45 * a, s + .85 * a), e.lineTo(i + .6 * a, s - .55 * a);
		}
		e.stroke(), e.restore();
	}
	var Oi = class {
		constructor(e) {
			Object.defineProperty(this, "_opts", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_values", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_buttons", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_width", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_plotWidth", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_plotHeight", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_suppressed", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), this._opts = {
				font: 11,
				left: 8,
				top: 6,
				row: 0,
				...e
			};
		}
		attached(e) {
			this._host = e;
		}
		detached() {
			this._host = null;
		}
		zOrder() {
			return "top";
		}
		autoscaleInfo() {
			return null;
		}
		setSuppressed(e) {
			this._suppressed !== e && (this._suppressed = e, e && this._clearGeometry(), this._host?.requestUpdate());
		}
		_clearGeometry() {
			this._buttons = [], this._width = this._plotWidth = this._plotHeight = 0;
		}
		setValue(e, t) {
			this.setValues("" === e ? [] : [{
				text: e,
				color: t
			}]);
		}
		setValues(e) {
			e.length === this._values.length && e.every((e, t) => e.text === this._values[t].text && e.label === this._values[t].label && e.color === this._values[t].color && e.field === this._values[t].field && e.priority === this._values[t].priority) || (this._values = e.map((e) => ({ ...e })), this._host?.requestUpdate());
		}
		setOptions(e) {
			const t = this._opts.statusLine;
			this._opts = {
				...this._opts,
				...e
			}, void 0 !== e.statusLine && (this._opts.statusLine = {
				...t,
				...e.statusLine
			}), !1 === this._opts.visible && this._clearGeometry(), this._host?.requestUpdate();
		}
		_status() {
			const e = this._opts.status;
			return void 0 === e ? gi : ("function" == typeof e ? e() : e) ?? gi;
		}
		options() {
			return this._opts;
		}
		draw(e, t) {
			const i = this._opts;
			if (this._suppressed || !1 === i.visible) return void this._clearGeometry();
			const s = t.dpr, r = (i.font ?? 11) * s, n = vi(i), o = yi(i), a = ((i.top ?? 6) + (i.row ?? 0) * o) * s, l = a + o * s / 2, h = (i.left ?? 8) * s;
			let c = h;
			const d = !0 === i.hidden, u = i.statusLine ?? bi, _ = this._status(), p = ie(t.theme.axisText, .55);
			this._plotWidth = Math.max(0, t.plotWidth), this._plotHeight = Math.max(0, t.plotHeight);
			const f = Math.max(0, (this._plotWidth - 4) * s - h), m = "string" == typeof t.hoverId && t.hoverId.startsWith(`${i.id}::`), b = Math.max(0, Math.floor((f / s - 6) / (n + 2))), g = m && b > 0 ? (i.actions ?? Si).slice(-b) : [], v = g.length ? (g.length * (n + 2) + 6) * s : 0;
			e.save(), e.beginPath(), e.rect(0, 0, this._plotWidth * s, t.plotHeight * s), e.clip(), e.textBaseline = "middle", e.textAlign = "left", e.globalAlpha = d ? .45 : 1;
			const y = [], w = (t, i, n, o) => (e.font = `${n ? "600 " : ""}${r}px ${mi}`, {
				k: "text",
				text: t,
				color: i,
				bold: n,
				w: e.measureText(t).width,
				gap: o * s
			}), x = (e, t, i = 1) => {
				const s = [];
				void 0 !== e.label && "" !== e.label && s.push(w(e.label, p, !1, 3)), s.push(w(e.text, e.color ?? t, !1, 6)), y.push({
					parts: s,
					priority: Number.isFinite(e.priority) ? e.priority : i,
					reading: i > 0
				});
			};
			let S;
			if (void 0 !== _.logo && !1 !== u.logo && y.push({
				parts: [{
					k: "logo",
					img: _.logo,
					w: 12 * s,
					gap: 5 * s
				}],
				priority: -1
			}), void 0 !== i.color && y.push({
				parts: [{
					k: "dot",
					color: i.color,
					w: 6 * s,
					gap: 5 * s
				}],
				priority: -1
			}), !1 !== u.title) {
				const e = u.titleMode ?? "symbol";
				S = w(("description" === e ? _.description : "ticker" === e ? _.ticker : void 0) ?? i.title, t.theme.axisText, !0, 6), y.push({
					parts: [S],
					priority: 0
				});
			}
			void 0 !== i.params && "" !== i.params && y.push({
				parts: [w(i.params, p, !1, 6)],
				priority: -3
			}), void 0 !== _.marketStatus && !1 !== u.marketStatus && x(_.marketStatus, p, -4);
			const P = i.valueColor ?? i.color ?? t.theme.axisText;
			for (const e of this._values) xi(u, e.field, i.hasOpenInterest) && x(e, P);
			void 0 !== _.lastDayChange && !1 !== u.lastDayChange && x(_.lastDayChange, P, -2), e.font = `600 ${r}px ${mi}`;
			const O = function(e, t, i, s) {
				if (t.reduce((e, t) => e + wi(t), 0) <= s) return t.flatMap((e) => e.parts);
				const r = t.filter((e) => !e.parts.includes(i)).sort((e, t) => t.priority - e.priority);
				if ("text" === i?.k) {
					const t = r.find((e) => e.reading), n = t ? wi(t) : 0, o = n <= .75 * s ? n : 0, a = Math.max(0, s - o - i.gap);
					if (i.w > a) {
						const t = Array.from(i.text);
						let s = 0, r = t.length;
						for (; s < r;) {
							const i = Math.ceil((s + r) / 2);
							e.measureText(t.slice(0, i).join("") + "...").width <= a ? s = i : r = i - 1;
						}
						i.text = e.measureText("...").width <= a ? t.slice(0, s).join("") + "..." : "", i.w = e.measureText(i.text).width, i.text || (i.gap = 0);
					}
					s -= i.w + i.gap;
				}
				const n = /* @__PURE__ */ new Set();
				for (const e of r) {
					const t = wi(e);
					t <= s && (n.add(e), s -= t);
				}
				return t.filter((e) => e.parts.includes(i) || n.has(e)).flatMap((e) => e.parts);
			}(e, y, S, Math.max(0, f - v)), k = O[O.length - 1];
			if (!0 === u.background && void 0 !== k) {
				const i = 4 * s, r = O.reduce((e, t) => e + t.w + t.gap, 0) - k.gap + 2 * i;
				e.globalAlpha = 1, e.fillStyle = ie(u.backgroundColor ?? t.theme.background, u.backgroundOpacity ?? .8), e.beginPath(), e.roundRect(h - i, l - o / 2 * s, r, o * s, 4 * s), e.fill(), e.globalAlpha = d ? .45 : 1;
			}
			for (const t of O) "text" === t.k ? (e.font = `${t.bold ? "600 " : ""}${r}px ${mi}`, e.fillStyle = t.color, e.fillText(t.text, c, l)) : "dot" === t.k ? (e.fillStyle = t.color, e.beginPath(), e.arc(c + 3 * s, l, 3 * s, 0, 2 * Math.PI), e.fill()) : e.drawImage(t.img, c, l - t.w / 2, t.w, t.w), c += t.w + t.gap;
			if (this._buttons = [], g.length > 0) {
				const r = (g.length * (n + 2) + 6) * s;
				e.globalAlpha = 1, e.fillStyle = ie(t.theme.background, .82), e.beginPath(), e.roundRect(c - 3 * s, l - o / 2 * s, r, o * s, 5 * s), e.fill(), c += 2 * s;
				for (const r of g) {
					const o = `${i.id}::${r}`, h = c;
					this._buttons.push({
						id: o,
						x: h / s,
						y: a / s
					});
					const u = t.hoverId === o;
					u && (e.fillStyle = ie(t.theme.axisText, .16), e.beginPath(), e.roundRect(h, l - n / 2 * s, n * s, n * s, 4 * s), e.fill()), e.globalAlpha = d ? .5 : u ? 1 : .75, e.fillStyle = "close" === r && u ? "#ff6b6b" : t.theme.axisText, Pi(e, r, h + n / 2 * s, l, n, s, i), e.globalAlpha = 1, c += (n + 2) * s;
				}
			}
			this._width = c / s, e.restore();
		}
		hitTest(e, t) {
			if (this._suppressed || !1 === this._opts.visible) return null;
			if (e < 0 || e >= this._plotWidth || t < 0 || t >= this._plotHeight) return null;
			const i = this._opts, s = yi(i), r = (i.top ?? 6) + (i.row ?? 0) * s;
			if (t < r || t > r + s) return null;
			const n = vi(i);
			for (const t of this._buttons) if (e >= t.x && e <= t.x + n) return {
				externalId: t.id,
				zOrder: "top",
				distance: 0,
				cursor: "pointer"
			};
			const o = Math.max(this._width, (i.left ?? 8) + 40) + 130;
			return e >= (i.left ?? 8) - 4 && e <= o ? {
				externalId: `${i.id}::row`,
				zOrder: "top",
				distance: 0,
				cursor: "default"
			} : null;
		}
	};
	function ki(e) {
		return "canvas2d" === e.kind || void 0 === e.device ? null : e.device.lost ? "context-lost" : e.device.available ? null : "unavailable";
	}
	var Ii = /* @__PURE__ */ new Map();
	function Mi(e, t) {
		Ii.set(e, t);
	}
	function ji(e = "canvas2d") {
		const t = Ii.get("canvas2d");
		if (void 0 === t) throw new Error("openalgo-charts: no canvas2d render backend is registered");
		if ("auto" === e) {
			const e = Ii.get("webgl2");
			return void 0 === e ? t : () => e() ?? t();
		}
		const i = Ii.get(e);
		if (void 0 === i) throw new Error(`openalgo-charts: render backend "${e}" is not registered; import the tier that provides it first`);
		return "canvas2d" === e ? i : () => i() ?? t();
	}
	var Li = class {
		constructor() {
			Object.defineProperty(this, "kind", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "canvas2d"
			}), Object.defineProperty(this, "_canvas", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_ctx", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			});
		}
		mount(e, t) {
			if (this._canvas = e, this._ctx = t ?? e.getContext("2d"), null === this._ctx) throw new Error("openalgo-charts: 2D canvas context is not available");
		}
		resize(e, t, i) {}
		beginFrame(e) {
			e && null !== this._ctx && null !== this._canvas && (this._ctx.setTransform(1, 0, 0, 1, 0, 0), this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height));
		}
		drawSeries(e, t, i, s, r, n, o) {
			null !== this._ctx && e.draw(this._ctx, t, i, s, r, n, o);
		}
		endFrame() {}
		overlay2d() {
			return this._ctx;
		}
		destroy() {
			this._ctx = null, this._canvas = null;
		}
	};
	function Ni(e, t) {
		if ("string" == typeof e.color) return e.color;
		const i = t ? e.upColor : e.downColor;
		return "string" == typeof i ? i : "string" == typeof e.closeColor ? e.closeColor : void 0;
	}
	Mi("canvas2d", () => new Li());
	var Ri = {
		bottom: 0,
		normal: 2,
		top: 3
	};
	var Fi = {
		start: 0,
		lastTime: 0
	};
	var zi = {
		kind: "ohlc",
		dpr: 1,
		factor: 1
	};
	var Ei = new Set(Ae().map(je));
	var Bi = class {
		constructor(e, t = new Li()) {
			Object.defineProperty(this, "element", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "base", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "top", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_separator", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_backend", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_rightScale", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: new y()
			}), Object.defineProperty(this, "_leftScale", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_overlayScales", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_axisLayout", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: new F()
			}), Object.defineProperty(this, "_ratioLocks", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "weight", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 1
			}), Object.defineProperty(this, "_series", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_primitives", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_primitiveScales", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_stackAbove", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_source", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_destroyed", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_width", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_height", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_drawItems", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_hitBoxes", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: Ke()
			}), Object.defineProperty(this, "_hitEpoch", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), this.element = e.createElement("div"), this.element.style.position = "relative", this.element.style.width = "100%", this.element.style.flex = "1 1 auto", this.element.style.overflow = "hidden", this.element.style.borderTopStyle = "solid", this.element.style.borderTopWidth = "0px", this.element.style.boxSizing = "border-box", this.base = new d(e, 0), this.top = new d(e, 1), this.element.appendChild(this.base.element), this.element.appendChild(this.top.element);
			const i = e.createElement("div"), s = i.style;
			s.position = "absolute", s.left = "0", s.top = "0", s.width = "100%", s.height = "0px", s.zIndex = "2", s.pointerEvents = "none", s.display = "none", this._separator = i, this.element.appendChild(i), this._backend = t, t.mount(this.base.element, this.base.ctx);
		}
		get backend() {
			return this._backend;
		}
		setBackend(e) {
			e !== this._backend && (this._backend.destroy(), this._backend = e, e.mount(this.base.element, this.base.ctx), this._width > 0 && this._height > 0 && e.resize(this._width, this._height, this.base.pixelRatio));
		}
		get backendDegradation() {
			return ki(this._backend);
		}
		get priceScale() {
			return this._rightScale;
		}
		addSeries(e) {
			this._scaleFor(e.scaleId), this._series.push(e), this._hitEpoch++;
		}
		_scaleFor(e) {
			if (this._axisLayout.register(e), "left" === e) return this._leftScale ?? (this._leftScale = new y());
			if ("" === e || e.startsWith("overlay:")) {
				let t = this._overlayScales.get(e);
				return t || (t = new y(), this._overlayScales.set(e, t)), t;
			}
			return this._rightScale;
		}
		scaleFor(e) {
			return this._scaleFor(e);
		}
		usesScale(e) {
			if (this._series.some((t) => t.scaleId === e)) return !0;
			for (const t of this._primitiveScales.values()) if (t === e) return !0;
			return !1;
		}
		axisPlacement(e) {
			return this._axisLayout.get(e);
		}
		setAxisPlacement(e, t, i) {
			return !!this._axisLayout.set(e, t, i) && (this._hitEpoch++, this._retainPlacedScales(), !0);
		}
		restoreAxisPlacements(e) {
			this._axisLayout.restore(e), this._hitEpoch++, this._retainPlacedScales();
		}
		_retainPlacedScales() {
			for (const { scaleId: e } of this._axisLayout.entries()) this._axisLayout.configured(e) && this._scaleFor(e);
		}
		visibleAxes(e = !0) {
			const t = e && 0 === this._series.length && 0 === this._primitiveScales.size;
			return this._axisLayout.entries().filter((e) => "hidden" !== e.side && (this.usesScale(e.scaleId) || t && "right" === e.scaleId)).sort((e, t) => e.side.localeCompare(t.side) || e.order - t.order);
		}
		axisSlots(e) {
			if (!0 === e.collapsed) return [];
			const t = this._layout(e), i = {
				left: 0,
				right: 0
			};
			return this.visibleAxes(e.emptyPriceAxis).map((s) => {
				const r = e.axisColumnWidth ?? ("left" === s.side ? t.plotLeft : t.priceAxisWidth), n = i[s.side]++;
				return {
					...s,
					width: r,
					x: "left" === s.side ? -(n + 1) * r : t.plotWidth + n * r
				};
			}).filter((e) => e.width > 0);
		}
		moveSeriesScale(e, t) {
			if (e === t || !this.usesScale(e) || this.usesScale(t)) return !1;
			this._hitEpoch++;
			const i = this._scaleFor(e), s = this._scaleFor(t);
			this._axisLayout.set(t, t), this._axisLayout.set(e, e), "left" === t ? (this._leftScale = i, this._rightScale = s) : (this._rightScale = i, this._leftScale = s);
			for (const i of this._series) i.scaleId === e && (i.scaleId = t);
			for (const [i, s] of this._primitiveScales) s === e && this._primitiveScales.set(i, t);
			s.setFixedRange(null), s.setAutoScale(!0), s.reset();
			const r = this._ratioLocks.get(e);
			return void 0 !== r && (this._ratioLocks.delete(e), this._ratioLocks.set(t, r)), !0;
		}
		ratioLocked(e) {
			return this._ratioLocks.has(e);
		}
		setRatioLock(e, t, i, s) {
			if (!t) return this._ratioLocks.delete(e), !0;
			const r = this._scaleFor(e);
			return !!(r.scaled && i > 0 && s > 0) && (r.setAutoScale(!1), this._ratioLocks.set(e, {
				barSpacing: i,
				height: s
			}), !0);
		}
		clearRatioLocks() {
			this._ratioLocks.clear();
		}
		scaleOf(e) {
			return this._scaleFor(e.scaleId);
		}
		scales() {
			const e = [this.priceScale];
			return null !== this._leftScale && e.push(this._leftScale), e.push(...this._overlayScales.values()), e;
		}
		scaleStates() {
			const e = [["right", this.priceScale]];
			return null !== this._leftScale && e.push(["left", this._leftScale]), e.push(...this._overlayScales), Object.fromEntries(e.map(([e, t]) => {
				const i = t.options, s = {
					marginTop: i.marginTop,
					marginBottom: i.marginBottom,
					minMove: i.minMove,
					minPrecision: i.minPrecision,
					mode: i.mode,
					inverted: i.inverted,
					autoScale: t.autoScale,
					fixedRange: t.fixedRange,
					placement: this._axisLayout.get(e)
				};
				t.autoScale || (s.range = t.priceRange());
				const r = this._ratioLocks.get(e);
				return r && !t.autoScale && (s.ratioLock = { ...r }), [e, s];
			}));
		}
		axisScales() {
			return this._axisLayout.entries().filter((e) => "hidden" !== e.side).map((e) => this._scaleFor(e.scaleId));
		}
		hasLeftScale() {
			return null !== this._leftScale && this.usesScale("left");
		}
		removeSeries(e) {
			const t = this._series.indexOf(e);
			if (t < 0) return !1;
			if (this._series.splice(t, 1), this._drawItems.delete(e), this._hitEpoch++, !this.usesScale(e.scaleId)) {
				const t = this._scaleFor(e.scaleId);
				t.reset(), "" === e.scaleId || "hidden" !== this._axisLayout.get(e.scaleId).side || this._axisLayout.configured(e.scaleId) || t.hasConfiguration() || this._ratioLocks.has(e.scaleId) || this._overlayScales.delete(e.scaleId);
			}
			return !0;
		}
		series() {
			return this._series;
		}
		reorderSeries(e) {
			const t = new Set(e), i = e.filter((e) => this._series.includes(e));
			this._hitEpoch++;
			let s = 0;
			for (let e = 0; e < this._series.length; e++) t.has(this._series[e]) && (this._series[e] = i[s++]);
		}
		setSourceSeries(e) {
			this._source = e, this._hitEpoch++;
		}
		_shownSource() {
			const e = this._source;
			return null !== e && !1 !== e.style.visible && je(e.type).isPriceSeries && this._series.includes(e) ? e : void 0;
		}
		moveSeries(e, t) {
			const i = this._series.indexOf(e);
			if (i < 0 || e === t) return;
			this._hitEpoch++, this._series.splice(i, 1);
			const s = null === t ? -1 : this._series.indexOf(t);
			this._series.splice(s < 0 ? this._series.length : s, 0, e);
		}
		reorderPrimitives(e) {
			const t = new Set(e), i = e.filter((e) => this._primitives.includes(e));
			this._hitEpoch++;
			let s = 0;
			for (let e = 0; e < this._primitives.length; e++) t.has(this._primitives[e]) && (this._primitives[e] = i[s++]);
		}
		transferPrimitive(e, t) {
			const i = this._primitives.indexOf(e);
			if (i < 0 || t === this || t._destroyed || t.hasPrimitive(e)) return !1;
			const s = this._primitiveScales.get(e);
			void 0 !== s && t._scaleFor(s);
			const r = this._stackAbove.get(e);
			return this._primitives.splice(i, 1), this._primitiveScales.delete(e), this._stackAbove.delete(e), this._hitEpoch++, t._hitEpoch++, t._primitives.push(e), void 0 !== s && t._primitiveScales.set(e, s), void 0 !== r && t._stackAbove.set(e, r), !0;
		}
		setPrimitiveStackAbove(e, t) {
			return !(this._destroyed || !this.hasPrimitive(e)) && (null === t ? this._stackAbove.delete(e) : this._stackAbove.set(e, t), !0);
		}
		primitiveStackAbove(e) {
			return this._stackAbove.get(e) ?? null;
		}
		_slotted(e, t) {
			if (0 === this._stackAbove.size || void 0 === t.stackSlot) return null;
			let i = null;
			for (const s of e) {
				const e = this._stackAbove.get(s), r = void 0 === e ? void 0 : t.stackSlot(e);
				void 0 !== r && this._series.includes(r) && (i ?? (i = /* @__PURE__ */ new Map())).set(s, r);
			}
			return i;
		}
		paintsBelowSeries(e, t, i) {
			const s = this._stackAbove.get(e), r = void 0 === s ? void 0 : i.stackSlot?.(s), n = void 0 === r ? -1 : this._series.indexOf(r);
			return n >= 0 ? n < this._series.indexOf(t) : "bottom" === e.zOrder();
		}
		bindPrimitiveScale(e, t) {
			return !(this._destroyed || !this.hasPrimitive(e)) && !(null !== t && !L(t)) && this.primitiveScaleId(e) !== t && (this._hitEpoch++, null === t ? this._primitiveScales.delete(e) : (this._scaleFor(t), this._primitiveScales.set(e, t)), !0);
		}
		primitiveScaleId(e) {
			return this._primitiveScales.get(e) ?? null;
		}
		primitives() {
			return this._primitives;
		}
		addPrimitive(e, t) {
			this._primitives.push(e), this._hitEpoch++, e.attached?.(void 0 === e.hitBounds ? t : function(e) {
				return { requestUpdate: () => {
					Ue++, e.requestUpdate();
				} };
			}(t));
		}
		hasPrimitive(e) {
			return this._primitives.includes(e);
		}
		removePrimitive(e) {
			const t = this._primitives.indexOf(e);
			return !(t < 0) && (this._primitives.splice(t, 1), this._primitiveScales.delete(e), this._stackAbove.delete(e), this._hitEpoch++, e.detached?.(), !0);
		}
		destroy() {
			this._destroyed = !0, this._primitiveScales.clear(), this._stackAbove.clear(), this._drawItems.clear(), this._hitBoxes.clear();
			for (const e of this._primitives) e.detached?.();
			this._primitives.length = 0, this._backend.destroy(), this.element.remove();
		}
		_primitiveContext(e) {
			const t = this._layout(e), i = this.axisSlots(e).find((e) => "right" === e.scaleId);
			return {
				timeScale: e.timeScale,
				priceScale: this.priceScale,
				readoutPriceScale: this._readoutScale(),
				dataLayer: e.dataLayer,
				plotWidth: t.plotWidth,
				plotHeight: t.plotHeight,
				priceAxisWidth: i?.width ?? 0,
				priceAxisSide: i?.side ?? "hidden",
				priceAxisOffset: i ? i.x + ("left" === i.side ? i.width : 0) : void 0,
				dpr: e.dpr,
				theme: e.theme,
				hoverId: e.hoverId ?? null,
				hoverKey: e.hoverKey ?? null,
				dragId: e.dragId ?? null,
				bars: () => {
					for (const t of null !== this._source && this._series.includes(this._source) ? [this._source, ...this._series] : this._series) if (je(t.type).isPriceSeries) return e.dataLayer.seriesBars(t.dataId);
					return [];
				}
			};
		}
		_boundPrimitiveContext(e, t, i) {
			const s = this._primitiveScales.get(e);
			if (void 0 === s) return t;
			const r = this.axisSlots(i).find((e) => e.scaleId === s);
			return {
				...t,
				priceScale: this._scaleFor(s),
				priceAxisSide: r?.side ?? "hidden",
				priceAxisWidth: r?.width ?? 0,
				priceAxisOffset: r ? r.x + ("left" === r.side ? r.width : 0) : void 0
			};
		}
		_live(e) {
			return !0 === e.collapsed ? this._primitives.filter((e) => e instanceof Oi) : this._primitives;
		}
		hitTestPrimitives(e, t, i, s) {
			const r = this._primitiveContext(i), n = this._live(i), o = this._slotted(n, i);
			this._checkHitBoxes(i);
			let a = null, l = 0;
			for (let h = 0; h < n.length; h++) {
				const c = n[h];
				if (!c.hitTest || c === s) continue;
				let d, u = this._hitBoxes.kept(h);
				if (void 0 === u && (u = this._hitBoxes.measure(h, c, d = this._boundPrimitiveContext(c, r, i))), !Ye(u, e, t)) continue;
				d ?? (d = this._boundPrimitiveContext(c, r, i));
				let _ = c.hitTest(e, t, d);
				if (null === _) continue;
				this._primitiveScales.has(c) && (_ = {
					..._,
					priceScale: d.priceScale
				});
				const p = _.paintedBy ?? c, f = o?.get(p);
				void 0 !== f && (_ = {
					..._,
					paintedBy: p
				});
				const m = void 0 !== f ? 1 + (this._series.indexOf(f) + 1) / (this._series.length + 1) : Ri[p === c ? _.zOrder : p.zOrder()], b = +(m >= 2) - +(l >= 2);
				if ((null === a || b > 0 || 0 === b && (_.distance < a.distance || _.distance === a.distance && m > l)) && (a = _, l = m, 0 === a.distance && l >= Ri.top)) break;
			}
			return a;
		}
		_paintedHitBoxes(e) {
			this._checkHitBoxes(e), this._hitBoxes.painted();
		}
		_checkHitBoxes(e) {
			const t = this._hitBoxes, i = e.timeScale, s = e.dataLayer;
			t.begin(), t.number(this._hitEpoch), t.number(e.dpr), t.number(this._width), t.number(this._height), t.number(e.priceAxisWidth), t.number(e.leftAxisWidth ?? 0), t.number(e.axisColumnWidth ?? -1), t.number(e.showTimeAxis ? e.timeAxisHeight : -1), t.number(!0 === e.collapsed ? 1 : 0), t.number(!1 === e.emptyPriceAxis ? 0 : 1), t.number(i.barSpacing), t.number(i.rightOffset), t.number(i.width), t.number(s.length), t.number(s.indexToTime(0) ?? NaN), t.number(s.indexToTime(s.baseIndex) ?? NaN), t.scale(this._rightScale), null !== this._leftScale && t.scale(this._leftScale);
			for (const e of this._overlayScales.values()) t.scale(e);
			t.ref(e.hoverId ?? null), t.ref(e.hoverKey ?? null), t.ref(e.dragId ?? null), t.ref(e.theme), t.ref(s.sessionCalendar), t.ref(this._readoutScale()), t.ref(this._rightScale), t.end();
		}
		setSeparator(e, t) {
			const i = function(e) {
				return !(e > 0) || !Number.isFinite(e) || Number.isInteger(e);
			}(t) ? e : null, s = null === i ? e : null, r = this.element.style;
			r.borderTopWidth = null === i ? "0px" : "1px", r.borderTopColor = i ?? "transparent";
			const n = this._separator.style;
			n.display = null === s ? "none" : "", n.height = `${null === s ? 0 : function(e) {
				return e > 0 && Number.isFinite(e) ? Math.max(1, Math.floor(e)) / e : 1;
			}(t)}px`, n.background = s ?? "transparent";
		}
		resize(e, t, i) {
			this._width = e, this._height = t, this.base.resize(e, t, i), this.top.resize(e, t, i), this._backend.resize(e, t, i);
		}
		setLayoutSize(e, t) {
			this._width = e, this._height = t;
		}
		setScaleHeights(e) {
			this.priceScale.setHeight(e), this._leftScale?.setHeight(e);
			for (const t of this._overlayScales.values()) t.setHeight(e);
		}
		_layout(e) {
			const t = e.leftAxisWidth ?? 0;
			return {
				plotWidth: Math.max(0, this._width - e.priceAxisWidth - t),
				plotHeight: Math.max(0, this._height - (e.showTimeAxis ? e.timeAxisHeight : 0)),
				priceAxisWidth: e.priceAxisWidth,
				timeAxisHeight: e.showTimeAxis ? e.timeAxisHeight : 0,
				plotLeft: t
			};
		}
		autoscale(e, t = 1) {
			let i = !1;
			const s = this._layout(e), r = e.timeScale.visibleRange();
			i = this._autoscaleScale(this.priceScale, "right", e, s.plotHeight, r, t) || i, this._leftScale && (i = this._autoscaleScale(this._leftScale, "left", e, s.plotHeight, r, t) || i);
			for (const [n, o] of this._overlayScales) i = this._autoscaleScale(o, n, e, s.plotHeight, r, t) || i;
			this._ratioLocks.size > 0 && this._applyRatioLocks(e.timeScale.barSpacing, s.plotHeight);
			for (const e of this._primitives) e.afterAutoscale?.();
			return i;
		}
		_autoscaleScale(e, t, i, s, r, n) {
			const o = !0 === i.priceOnlyAutoScale && this._series.some((e) => e.dataId === i.primaryDataId && e.scaleId === t), a = (e) => e.scaleId === t && (!o || e.dataId === i.primaryDataId);
			e.setHeight(s);
			const l = e.options.mode;
			if ("percentage" !== l && "indexed-to-100" !== l || e.setBaseline(this._firstVisibleValue(a, i, r, o)), !e.autoScale) return !1;
			let h = 1 / 0, c = -1 / 0;
			for (const e of this._series) {
				if (!1 === e.style.visible || !a(e)) continue;
				const t = je(e.type), s = e.style.barOffset ?? 0, n = i.dataLayer, o = n.seriesBars(e.dataId), l = Fi;
				if (T(n, o, r.from - s, r.to - s, l)) for (let i = l.start; i < o.length; i++) {
					const s = o[i];
					if (s.time > l.lastTime) break;
					if (void 0 === n.timeToIndex(s.time)) continue;
					const r = t.extents(s, e.style);
					r.min < h && (h = r.min), r.max > c && (c = r.max);
				}
			}
			for (const e of this._primitives) {
				if (o) break;
				if ((this._primitiveScales.get(e) ?? "right") !== t) continue;
				const i = e.autoscaleInfo?.();
				i && (i.min < h && (h = i.min), i.max > c && (c = i.max));
			}
			return h <= c && e.autoscale(h, c, n);
		}
		_applyRatioLocks(e, t) {
			if (e > 0 && t > 0) for (const [i, s] of this._ratioLocks) {
				const r = t / e / (s.height / s.barSpacing);
				if (s.barSpacing = e, s.height = t, !isFinite(r) || r <= 0 || Math.abs(r - 1) < 1e-9) continue;
				const n = this._scaleFor(i);
				n.scaled && this._scaleSpan(n, r);
			}
		}
		_scaleSpan(e, t) {
			const i = e.height;
			if (!(i > 0)) return;
			const s = i / 2 * t, r = e.yToPrice(i / 2 - s), n = e.yToPrice(i / 2 + s);
			isFinite(r) && isFinite(n) && r !== n && e.setPriceRange({
				min: Math.min(r, n),
				max: Math.max(r, n)
			});
		}
		_firstVisibleValue(e, t, i, s = !1) {
			const r = this._shownSource();
			for (const n of r ? [r, ...this._series] : this._series) {
				if (!1 === n.style.visible || !e(n)) continue;
				const r = s ? n.style.barOffset ?? 0 : 0, o = t.dataLayer, a = o.seriesBars(n.dataId), l = Fi;
				if (T(o, a, i.from - r, i.to - r, l)) for (let e = l.start; e < a.length; e++) {
					const t = a[e];
					if (t.time > l.lastTime) break;
					if (void 0 !== o.timeToIndex(t.time) && isFinite(t.close)) return t.close;
				}
			}
			return null;
		}
		paintBase(e, t) {
			const i = this._layout(e), s = e.dpr, r = t ?? this._backend.overlay2d() ?? this.base.ctx;
			void 0 === t && this._backend.beginFrame(!0);
			const n = !0 !== e.collapsed, o = this._live(e), a = W(e.theme, e.canvasOptions?.scales);
			!1 !== e.paintBackground && "transparent" !== e.theme.background && (r.fillStyle = e.theme.background, r.fillRect(0, 0, Math.round(this._width * s), Math.round(this._height * s))), r.save(), i.plotLeft > 0 && r.translate(Math.round(i.plotLeft * s), 0);
			const l = e.canvasOptions?.grid, h = function(e, t, i) {
				const s = Math.max(1, i.spacing), r = [];
				if (!1 !== i.vertLines) for (let t = s; t < e; t += s) r.push(t);
				const n = [];
				if (!1 !== i.horzLines) for (let e = s; e < t; e += s) n.push(e);
				return {
					verticals: r,
					horizontals: n
				};
			}(i.plotWidth, i.plotHeight, {
				...l,
				spacing: l?.spacing ?? 60,
				vertLines: e.showVertGrid && n,
				horzLines: e.showHorzGrid && n
			});
			(h.verticals.length > 0 || h.horizontals.length > 0) && function(e, t, i, s, r, n) {
				e.save(), e.lineWidth = Math.max(1, Math.round(n.lineWidth * r));
				const o = Math.round(i * r), a = Math.round(s * r);
				B(e, t.verticals, !0, n.vert, n, r, o, a), B(e, t.horizontals, !1, n.horz, n, r, o, a), e.setLineDash([]), e.restore();
			}(r, h, i.plotWidth, i.plotHeight, s, E(e.theme, l, s)), r.save(), r.beginPath(), r.rect(0, 0, Math.round(i.plotWidth * s), Math.round(i.plotHeight * s)), r.clip();
			const c = this._primitiveContext(e), d = this._slotted(o, e);
			for (const t of o) "bottom" !== t.zOrder() || d?.has(t) || t.draw(r, this._boundPrimitiveContext(t, c, e));
			const { readout: u, lastEntry: _, valueTags: p } = this._paintSeriesPass(r, e, i, n, c, d, t);
			void 0 === t && this._backend.endFrame(), r.restore();
			const f = this.axisSlots(e), m = {
				up: e.theme.lastPriceUp,
				down: e.theme.lastPriceDown,
				text: e.theme.lastPriceText
			}, b = _;
			null !== b && b.showLine && function(e, t, i, s, r, n, o = ti) {
				const a = Math.round(t.priceToY(i) * n);
				if (!Number.isFinite(a) || a < 0 || a > r.plotHeight * n) return;
				const l = s ? o.up : o.down, h = Math.round(r.plotWidth * n);
				e.save(), e.strokeStyle = l, e.lineWidth = Math.max(1, Math.round(n)), e.setLineDash([3 * n, 3 * n]), e.beginPath(), e.moveTo(0, a + .5), e.lineTo(h, a + .5), e.stroke(), e.setLineDash([]), e.restore();
			}(r, u, b.close, b.up, i, s, m);
			const g = null !== this._source && this._series.includes(this._source) ? e.barCountdown : void 0, v = (e) => null !== b && b.showTag && u === e;
			this._paintAxisLadders(r, i, s, f, p, b, v, g, a);
			for (const t of o) "normal" !== t.zOrder() || d?.has(t) || t.draw(r, this._boundPrimitiveContext(t, c, e));
			for (const e of f) null !== b && v(this._scaleFor(e.scaleId)) && this._inAxisSlot(r, e, i, s, (t, i) => di(r, t, b.close, b.up, i, s, a, {
				colors: m,
				countdown: g,
				side: e.side
			}));
			e.showTimeAxis && (function(e, t, i, s, r, n = Vt, o, a) {
				const l = t.visibleRange(), h = Math.max(0, Math.floor(l.from)), c = Math.min(i.baseIndex, Math.ceil(l.to));
				if (c < h) return;
				const d = Math.max(1, Math.round(80 / Math.max(1, t.barSpacing))), u = Math.round(s.plotHeight * r);
				let _ = Number.POSITIVE_INFINITY;
				{
					let e = i.indexToTime(h), t = Number.POSITIVE_INFINITY;
					for (let s = h + 1; s <= c; s++) {
						const r = i.indexToTime(s);
						if (void 0 !== r && void 0 !== e) {
							const i = r - e;
							i > 0 && Math.floor(r / 60) !== Math.floor(e / 60) ? _ = Math.min(_, i) : i > 0 && (t = Math.min(t, i));
						}
						void 0 !== r && (e = r);
					}
					Number.isFinite(_) || (_ = t);
				}
				const p = _ * d, f = Number.isFinite(p) && p < 60, m = void 0 !== a && a !== "Asia/Kolkata" && _t(a) ? a : "Asia/Kolkata", b = m === "Asia/Kolkata", g = b ? Zt : (e, t) => vt(e, t, m), v = b ? nt : (e) => At(e, m), y = b ? tt : (e) => Ct(e, m), w = b ? it : (e) => jt(e, m);
				e.save(), e.fillStyle = n.textColor, e.strokeStyle = n.lineColor, e.font = _i(n.font, r), e.textAlign = "center", e.textBaseline = "top", e.lineWidth = 1, e.beginPath(), e.moveTo(0, u + .5), e.lineTo(Math.round(s.plotWidth * r), u + .5), e.stroke();
				const x = /* @__PURE__ */ new Set();
				{
					let e = i.indexToTime(h);
					for (let t = h + 1; t <= c; t++) {
						const s = i.indexToTime(t);
						void 0 !== s && (void 0 !== e && g(e, s) && x.add(t), e = s);
					}
				}
				const S = [.../* @__PURE__ */ new Set([...ei(h, c, d), ...x])].sort((e, t) => e - t), P = [];
				let O;
				for (const n of S) {
					const a = i.indexToTime(n);
					if (void 0 === a) continue;
					const l = Math.round(t.indexToX(n) * r);
					if (l < 0 || l > s.plotWidth * r) {
						O = a;
						continue;
					}
					let h;
					h = o ? o(a, void 0 === O ? "day" : Jt(O, a, m, f)) : void 0 === O || g(O, a) ? v(a) : f ? w(a) : y(a), P.push({
						x: l,
						text: h,
						half: e.measureText(h).width / 2,
						boundary: x.has(n)
					}), O = a;
				}
				const k = 4 * r, I = [], M = (e) => I.every((t) => e.x + e.half + k <= t.x - t.half || e.x - e.half - k >= t.x + t.half);
				for (const e of P) e.boundary && M(e) && I.push(e);
				for (const e of P) !e.boundary && M(e) && I.push(e);
				I.sort((e, t) => e.x - t.x);
				for (const t of I) e.fillText(t.text, t.x, u + 4 * r);
				e.restore();
			}(r, e.timeScale, e.dataLayer, i, s, a, e.timeFormatter, e.timezone), void 0 !== e.sessionClock && ui(r, {
				...i,
				priceAxisWidth: Math.min(i.priceAxisWidth, e.axisColumnWidth ?? i.priceAxisWidth)
			}, s, e.sessionClock, a)), r.restore(), void 0 === t && this._paintedHitBoxes(e);
		}
		_paintSeriesPass(e, t, i, s, r, n, o) {
			const a = t.dpr, l = t.timeScale.visibleRange(), h = this._readoutScale(), c = this._shownSource(), d = void 0 !== c && this._scaleFor(c.scaleId) === h ? c : this._series.find((e) => !1 !== e.style.visible && je(e.type).isPriceSeries && this._scaleFor(e.scaleId) === h);
			let u = null;
			const _ = [], p = t.timeScale.barSpacing, f = $e(a, t.conflationFactor), m = t.conflate && function(e, t, i) {
				return e > 0 && e * t < i;
			}(p, a, f), b = zi;
			b.dpr = a, b.factor = t.conflationFactor;
			for (const h of this._series) {
				if (!1 === h.style.visible || !s) {
					this._paintSlot(n, h, e, r, t, o);
					continue;
				}
				const c = this._scaleFor(h.scaleId), g = je(h.type), v = h.style.barOffset ?? 0, y = m && Ei.has(g) ? Ee(h.type) : null;
				null !== y && (b.kind = y);
				let w = this._drawItems.get(h);
				void 0 === w && this._drawItems.set(h, w = Ve());
				const x = w.priceToY, S = w.build(t.dataLayer, h.dataId, l.from - v, l.to - v, v, t.timeScale, c, null === y ? null : b, !0 === g.connectsBars), P = "ohlc" === y ? Math.max(p, f / a) : p;
				if (!0 === h.style.colorByPreviousClose && S.length > 0) {
					const e = w.firstIndex() - 1, i = j(t.dataLayer, h.dataId, e);
					void 0 !== i && (S[0].prevClose = i.close);
				}
				let O = 0;
				for (let e = 0; e < S.length; e++) {
					const t = S[e].bar.volume ?? 0;
					t > O && (O = t);
				}
				const k = {
					plotHeight: i.plotHeight,
					maxVolume: O,
					theme: t.theme
				};
				void 0 === o ? this._backend.drawSeries(g, S, x, P, a, h.style, k) : g.draw(e, S, x, P, a, h.style, k);
				const I = t.dataLayer.lastIndexedBar(h.dataId);
				if (null !== I) {
					const e = Ni(h.style, I.bar.close >= I.bar.open);
					h === d && null === u ? u = {
						close: I.bar.close,
						up: I.bar.close >= I.bar.open,
						showLine: !1 !== h.style.priceLineVisible,
						showTag: !1 !== h.style.lastValueVisible && (void 0 === e || !se(e))
					} : !1 !== h.style.lastValueVisible && void 0 !== e && !se(e) && Number.isFinite(I.bar.close) && _.push({
						price: I.bar.close,
						color: e,
						scaleId: h.scaleId
					});
				}
				this._paintSlot(n, h, e, r, t, o);
			}
			return {
				readout: h,
				lastEntry: u,
				valueTags: _
			};
		}
		_paintAxisLadders(e, t, i, s, r, n, o, a, l) {
			for (const h of s) this._inAxisSlot(e, h, t, i, (s, c) => {
				const { side: d, width: u, scaleId: _ } = h, p = r.filter((e) => e.scaleId === _), f = [];
				if (null !== n && o(s)) {
					const e = oi(i, !0 === a?.visible), r = ai(Math.round(s.priceToY(n.close) * i), t.plotHeight * i, e, d);
					null !== r && f.push({
						y: r,
						height: e,
						priority: Ht
					});
				}
				const m = f.length;
				for (const e of p) {
					const r = oi(i), n = ai(Math.round(s.priceToY(e.price) * i), t.plotHeight * i, r, d);
					f.push({
						y: n ?? NaN,
						height: r,
						priority: Gt
					});
				}
				const b = f.length > 0 ? Kt(f, 2 * i) : [], g = f.length > 0 ? f.filter((e, t) => b[t]) : void 0;
				"left" === d ? (e.save(), e.translate(-Math.round(u * i), 0), Xt(e, s, c, i, l, g, "left"), e.restore()) : Xt(e, s, c, i, l, g);
				for (let t = 0; t < p.length; t++) b[m + t] && ci(e, s, p[t].price, p[t].color, c, i, l, d);
			});
		}
		_inAxisSlot(e, t, i, s, r) {
			const { side: n, width: o } = t, a = this._scaleFor(t.scaleId);
			if (!a.scaled) return;
			e.save();
			const l = Math.round(t.x * s), h = Math.round((t.x + o) * s);
			e.beginPath(), e.rect(l, 0, h - l, Math.round(i.plotHeight * s)), e.clip(), e.translate("left" === n ? h : l - Math.round(i.plotWidth * s), 0), r(a, {
				...i,
				priceAxisWidth: o,
				plotLeft: o
			}), e.restore();
		}
		_paintSlot(e, t, i, s, r, n) {
			if (null === e) return;
			let o = !1;
			for (const [a, l] of e) l === t && (o || void 0 !== n || this._backend.endFrame(), o = !0, a.draw(i, this._boundPrimitiveContext(a, s, r)));
		}
		paintTop(e, t, i) {
			void 0 === i && this.top.clearBitmap();
			const s = this._layout(t), r = i ?? this.top.ctx, n = t.dpr;
			r.save(), s.plotLeft > 0 && r.translate(Math.round(s.plotLeft * n), 0);
			const o = this._primitiveContext(t), a = this._live(t), l = 0 === this._stackAbove.size ? null : this._slotted(a.filter((e) => "top" === e.zOrder() && this._stackAbove.has(e)), t);
			for (const e of a) "top" !== e.zOrder() || l?.has(e) || e.draw(r, this._boundPrimitiveContext(e, o, t));
			if (null !== e) {
				const i = pi(t.theme, t.canvasOptions?.crosshair, n);
				!0 !== t.collapsed && fi(r, e.x, e.yLocal, s.plotWidth, s.plotHeight, n, i.color, i.width, i.dash);
				const o = t.theme.crosshairLabelBackground ?? i.color, a = !1 !== t.theme.crosshairLabelVisible, l = W(t.theme, t.canvasOptions?.scales);
				if (a && null !== e.yLocal) {
					const i = this._readoutScale(), a = this.axisSlots(t).find((e) => this._scaleFor(e.scaleId) === i);
					if (a) {
						const h = i.format(i.yToPrice(e.yLocal)), c = Math.round(a.x * n), d = Math.round((a.x + a.width) * n), u = "left" === a.side ? d - function(e, t, i, s = Vt) {
							e.save(), e.font = _i(s.font, i);
							const r = e.measureText(t).width + 12 * i + 1;
							return e.restore(), r;
						}(r, h, n, l) : c;
						r.save(), r.beginPath(), r.rect(c, 0, d - c, Math.round(s.plotHeight * n)), r.clip(), function(e, t, i, s, r, n, o, a, l = Vt) {
							e.save(), e.font = _i(l.font, r);
							const h = 6 * r, c = 16 * r, d = e.measureText(t).width;
							e.fillStyle = n, e.textBaseline = "middle", e.fillRect(i + 1, s - c / 2, d + 2 * h, c), e.fillStyle = o, e.textAlign = "left", e.fillText(t, i + 1 + h, s), e.restore();
						}(r, h, u, e.yLocal * n, n, o, t.theme.lastPriceText, 0, l), r.restore();
					}
				}
				if (a && e.showTimeTag && e.x >= 0 && e.x <= s.plotWidth) {
					const i = Math.round(t.timeScale.xToIndex(e.x)), a = t.dataLayer.indexToTime(i);
					if (void 0 !== a) (function(e, t, i, s, r, n, o = Vt) {
						e.save(), e.font = _i(o.font, r);
						const a = 7 * r, l = 18 * r, h = e.measureText(t).width + 2 * a, c = Math.max(0, i - h / 2), d = s + 1 * r, u = (n.radius ?? 4) * r;
						e.beginPath(), ne(e, c, d, h, l, u), void 0 !== n.backplate && (e.fillStyle = n.backplate, e.fill()), e.fillStyle = n.background, e.fill(), void 0 !== n.border && (e.strokeStyle = n.border, e.lineWidth = Math.max(1, Math.round(r)), e.stroke()), e.fillStyle = n.textColor, e.textAlign = "center", e.textBaseline = "middle", e.fillText(t, c + h / 2, d + l / 2), e.restore();
					})(r, t.timeFormatter ? t.timeFormatter(a) : Nt(a, t.timezone ?? "Asia/Kolkata"), e.x * n, s.plotHeight * n, n, {
						background: o,
						textColor: t.theme.lastPriceText,
						backplate: t.theme.background
					}, l);
				}
			}
			r.restore(), void 0 === i && this._paintedHitBoxes(t);
		}
		_readoutScale() {
			const e = this._shownSource();
			if (void 0 !== e) return this._scaleFor(e.scaleId);
			for (const e of this._series) if (!1 !== e.style.visible && je(e.type).isPriceSeries) return this._scaleFor(e.scaleId);
			return this._rightScale;
		}
		readoutScale() {
			return this._readoutScale();
		}
		priceToY(e) {
			return this._readoutScale().priceToY(e);
		}
		yToPrice(e) {
			return this._readoutScale().yToPrice(e);
		}
	};
	var $i = {
		friction: .0055,
		minSpeed: .02,
		triggerSpeed: .08
	};
	var Di = class {
		constructor(e, t = {}) {
			Object.defineProperty(this, "_v0", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_k", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_minSpeed", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_duration", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			});
			const i = {
				...$i,
				...t
			};
			this._v0 = e, this._k = i.friction, this._minSpeed = i.minSpeed;
			const s = Math.abs(this._v0) > 0 ? this._minSpeed / Math.abs(this._v0) : 1;
			this._duration = s >= 1 ? 0 : -Math.log(s) / this._k;
		}
		static shouldAnimate(e, t = {}) {
			const i = t.triggerSpeed ?? $i.triggerSpeed;
			return Math.abs(e) >= i;
		}
		distanceAt(e) {
			const t = Math.min(Math.max(0, e), this._duration);
			return this._v0 / this._k * (1 - Math.exp(-this._k * t));
		}
		get durationMs() {
			return this._duration;
		}
		finished(e) {
			return e >= this._duration;
		}
	};
	var Wi = {
		tau: 55,
		stopFraction: .995,
		minLogStep: .02
	};
	var qi = class {
		constructor(e, t = {}) {
			Object.defineProperty(this, "_base", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_target", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_epoch", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_tau", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_duration", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			});
			const i = {
				...Wi,
				...t
			};
			this._target = e, this._tau = i.tau, this._duration = -Math.log(1 - i.stopFraction) * i.tau;
		}
		static leadFraction(e = {}) {
			const t = e.tau ?? Wi.tau;
			return 1 - Math.exp(-16.666666666666668 / t);
		}
		static shouldAnimate(e, t = {}) {
			const i = t.minLogStep ?? Wi.minLogStep;
			return Math.abs(e) >= i;
		}
		add(e, t, i) {
			this._base = t, this._target += e, this._epoch = i;
		}
		appliedAt(e) {
			const t = e - this._epoch;
			return t <= 0 ? this._base : t >= this._duration ? this._target : this._base + (this._target - this._base) * (1 - Math.exp(-t / this._tau));
		}
		get totalLogFactor() {
			return this._target;
		}
		get durationMs() {
			return this._duration;
		}
		finished(e) {
			return e - this._epoch >= this._duration;
		}
	};
	var Vi = class {
		constructor(e, t) {
			Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_kinetic", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_zoomGlide", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_zoomFocus", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_zoomFrames", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_zoomGlideStart", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_zoomGlideApplied", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_animAutoscale", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_autoscaleTime", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_autoscaleFrames", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_navigationEpoch", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), this._host = e, this._animAutoscale = t;
		}
		_step() {
			return this._stepZoomGlide(), this._stepKinetic(), null !== this._zoomGlide || null !== this._kinetic;
		}
		_applyZoom(e, t) {
			!1 !== this._host._navigation.zoomEnabled && (this._beginAutoscaleMotion(), this._host._mutateTimeScale(() => this._host._timeScale.zoomAtX(e, Math.exp(t))), this._host._maybeLoadHistory(), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._emitViewport("zoom"));
		}
		_remainingZoom() {
			return null === this._zoomGlide ? 0 : this._zoomGlide.totalLogFactor - this._zoomGlideApplied;
		}
		_startZoomGlide(e, t) {
			!1 !== this._host._navigation.zoomEnabled && (this._zoomGlide = new qi(t), this._zoomFocus = e, this._zoomGlideStart = this._host._now(), this._zoomGlideApplied = 0, this._zoomFrames = 0, this._host._loop.requestFrame());
		}
		_stepZoomGlide() {
			const e = this._zoomGlide;
			if (null === e) return;
			if (this._host._destroyed || !1 === this._host._navigation.zoomEnabled) return void (this._zoomGlide = null);
			const t = this._host._now() - this._zoomGlideStart, i = e.appliedAt(t), s = i - this._zoomGlideApplied;
			if (this._zoomGlideApplied = i, 0 !== s && this._applyZoom(this._zoomFocus, s), this._zoomGlide === e && !this._host._destroyed && (e.finished(t) || ++this._zoomFrames >= 600)) {
				const t = e.totalLogFactor - this._zoomGlideApplied;
				0 !== t && this._applyZoom(this._zoomFocus, t), this._zoomGlide === e && (this._zoomGlide = null);
			}
		}
		_beginAutoscaleMotion() {
			this._animAutoscale && null === this._autoscaleTime && (this._autoscaleTime = this._host._now() - 16, this._autoscaleFrames = 0);
		}
		_autoscaleFraction() {
			const e = this._host._now(), t = null === this._autoscaleTime || ++this._autoscaleFrames >= 90 ? 1 : 1 - Math.exp(-Math.max(1, e - this._autoscaleTime) / 80);
			return null !== this._autoscaleTime && (this._autoscaleTime = e), t;
		}
		_stopNavigationMotion() {
			this._navigationEpoch++, this._stopZoomGlide(), this._stopKinetic(), this._autoscaleTime = null;
		}
		_stopDisabled(e, t) {
			t && (this._navigationEpoch++, this._stopZoomGlide()), e && this._stopKinetic(), this._autoscaleTime = null;
		}
		_stopZoomGlide() {
			this._zoomGlide = null;
		}
		_startKinetic(e) {
			if (!1 === this._host._navigation.panEnabled) return;
			this._stopKinetic();
			const t = new Di(e);
			t.durationMs <= 0 || (this._kinetic = {
				anim: t,
				start: this._host._now(),
				travelled: 0,
				frames: 0
			}, this._host._loop.requestFrame());
		}
		_stepKinetic() {
			const e = this._kinetic;
			if (null === e) return;
			if (this._host._destroyed || !1 === this._host._navigation.panEnabled) return void (this._kinetic = null);
			const t = this._host._now() - e.start, s = e.anim.distanceAt(t), r = s - e.travelled;
			e.travelled = s, this._beginAutoscaleMotion(), this._host._mutateTimeScale(() => this._host._timeScale.setRightOffset(this._host._timeScale.rightOffset - r / this._host._timeScale.barSpacing)), this._host._maybeLoadHistory(), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._emitViewport("pan"), this._kinetic === e && (e.anim.finished(t) || ++e.frames >= 600) && (this._kinetic = null);
		}
		_stopKinetic() {
			this._kinetic = null;
		}
	};
	var Hi = class {
		constructor(e) {
			Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_resizeObserver", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_deviceObserver", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_ratioQuery", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_ratioView", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), this._host = e;
		}
		_observeSize() {
			if ("undefined" != typeof ResizeObserver && (this._resizeObserver = new ResizeObserver((e) => {
				const t = e[0];
				t && (this._host.applySize(t.contentRect.width, t.contentRect.height), this._host._paintNow());
			}), this._resizeObserver.observe(this._host._container), "undefined" != typeof ResizeObserverEntry && "devicePixelContentBoxSize" in ResizeObserverEntry.prototype)) {
				this._deviceObserver = new ResizeObserver((e) => this._onDevicePixels(e));
				for (const e of this._host._panes) this._observeCanvases(e, !0);
			}
		}
		_observeCanvases(e, t) {
			const i = this._deviceObserver;
			if (null !== i) for (const s of [e.base, e.top]) t ? i.observe(s.element, { box: "device-pixel-content-box" }) : i.unobserve(s.element);
		}
		_onDevicePixels(e) {
			if (this._host._destroyed || this._host._destroying) return;
			let t = !1;
			for (const i of e) {
				const e = this._canvasLayerOf(i.target), s = i.devicePixelContentBoxSize?.[0], r = i.contentBoxSize?.[0];
				null !== e && void 0 !== s && void 0 !== r && (Math.abs(r.inlineSize - e.mediaWidth) > .05 || Math.abs(r.blockSize - e.mediaHeight) > .05 ? e.forgetDeviceSize() : e.setDeviceSize(s.inlineSize, s.blockSize) && (t = !0));
			}
			t && (this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._paintNow());
		}
		_canvasLayerOf(e) {
			for (const t of this._host._panes) {
				if (t.base.element === e) return t.base;
				if (t.top.element === e) return t.top;
			}
			return null;
		}
		_view() {
			return this._host._doc.defaultView || ("undefined" == typeof window ? null : window);
		}
		_watchPixelRatio() {
			this._unwatchPixelRatio();
			const e = this._view();
			if (null === e || this._host._destroying || this._host._destroyed) return;
			if ("function" == typeof e.addEventListener && (e.addEventListener("resize", this._host._checkPixelRatio), this._ratioView = e), "function" != typeof e.matchMedia) return;
			const t = e.matchMedia(`(resolution: ${e.devicePixelRatio || 1}dppx)`);
			"function" == typeof t?.addEventListener && (t.addEventListener("change", this._host._onPixelRatio), this._ratioQuery = t);
		}
		_unwatchPixelRatio() {
			this._ratioQuery?.removeEventListener("change", this._host._onPixelRatio), this._ratioQuery = null, this._ratioView?.removeEventListener("resize", this._host._checkPixelRatio), this._ratioView = null;
		}
		_onPixelRatio() {
			this._host._destroyed || this._host._destroying || (this._watchPixelRatio(), this._checkPixelRatio());
		}
		_checkPixelRatio() {
			this._host._destroyed || this._host._destroying || this._host._pixelRatio() === this._host._layoutRatio || (this._host._layout._relayout(), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._paintNow());
		}
	};
	function Gi(e) {
		const t = Math.abs(e);
		return t >= 1e9 ? (e / 1e9).toFixed(2) + "B" : t >= 1e6 ? (e / 1e6).toFixed(2) + "M" : t >= 1e3 ? (e / 1e3).toFixed(2) + "K" : String(Math.round(e));
	}
	var Yi = {
		background: "#ffffff",
		grid: "#eef1f6",
		axisText: "#5b6472",
		axisLine: "#d4dae3",
		paneSeparator: "#e6eaf0",
		crosshair: "#9aa3b2",
		upColor: "#089981",
		downColor: "#e0473e",
		wickUpColor: "#089981",
		wickDownColor: "#e0473e",
		lineColor: "#2962ff",
		areaTopColor: "rgba(41,98,255,0.30)",
		areaBottomColor: "rgba(41,98,255,0.00)",
		baselineTopLine: "#089981",
		baselineTopFill: "rgba(8,153,129,0.18)",
		baselineBottomLine: "#e0473e",
		baselineBottomFill: "rgba(224,71,62,0.18)",
		lastPriceUp: "#089981",
		lastPriceDown: "#e0473e",
		lastPriceText: "#ffffff",
		buy: "#089981",
		sell: "#e0473e",
		profit: "#089981",
		loss: "#e0473e"
	};
	function Xi(e, t = !1) {
		if (void 0 === e) return;
		if (null === e || "object" != typeof e || Array.isArray(e)) throw new TypeError("Series options must be an object");
		if (void 0 !== e.confirmation && "auto" !== e.confirmation && "forming" !== e.confirmation && "confirmed" !== e.confirmation) throw new TypeError("Series confirmation must be auto, forming or confirmed");
		const i = e.source;
		if (t && void 0 !== i && "live" !== i && "history" !== i) throw new TypeError("Series update source must be live or history");
	}
	var Ji = class {
		constructor(e) {
			Object.defineProperty(this, "_state", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_tailTime", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), this._state = Object.freeze({
				sourceId: e,
				revision: 0,
				historyRevision: 0,
				provenance: "history",
				change: "reset"
			});
		}
		snapshot() {
			return this._state;
		}
		record(e, t, i) {
			const s = "reset" === e || "prepend" === e || "correction" === e || "history" === i?.source, r = "correction" === e ? void 0 : i?.confirmation, n = "auto" === r ? void 0 : r ?? ("reset" !== e && t === this._tailTime ? this._state.confirmation : void 0);
			this._tailTime = t, this._state = Object.freeze({
				sourceId: this._state.sourceId,
				revision: this._state.revision + 1,
				historyRevision: this._state.historyRevision + (s ? 1 : 0),
				provenance: s ? "history" : "live",
				change: e,
				...void 0 === t || void 0 === n ? {} : {
					confirmation: n,
					confirmationSource: "provider"
				}
			});
		}
		contextChanged() {
			this.record("reset", this._tailTime);
		}
	};
	var Zi = /* @__PURE__ */ new WeakMap();
	var es = class extends Error {
		constructor(e) {
			super(e), this.name = "IndicatorInputError";
		}
	};
	function ts(e) {
		if (null === e || "object" != typeof e) return !1;
		const t = Object.getPrototypeOf(e);
		return t === Object.prototype || null === t;
	}
	function is(e) {
		return Object.values(Object.getOwnPropertyDescriptors(e)).every((e) => "value" in e);
	}
	function ss(e, t) {
		for (const i of e) {
			if (![
				"symbol",
				"session",
				"multiline",
				"price",
				"timestamp"
			].includes(i.type)) continue;
			const s = (e) => {
				throw new es(`Invalid study input "${i.key}": ${e}`);
			}, r = Object.getOwnPropertyDescriptor(t, i.key);
			r && !("value" in r) && s("expected a data property");
			const n = r ? r.value : i.default;
			if ("price" === i.type || "timestamp" === i.type) {
				const { min: t, max: r, step: o } = i;
				(void 0 !== t && !Number.isFinite(t) || void 0 !== r && !Number.isFinite(r) || void 0 !== t && void 0 !== r && t > r || void 0 !== o && (!Number.isFinite(o) || o <= 0)) && s("invalid numeric constraints");
				const a = (e) => "number" == typeof e && Number.isFinite(e) && (void 0 === t || e >= t) && (void 0 === r || e <= r);
				a(i.default) && a(n) || s("expected a finite number within the declared bounds");
				const l = i.pick;
				if (void 0 !== l && "boolean" != typeof l) {
					"price" === i.type && null !== l && "object" == typeof l || s("invalid pick target");
					const e = l;
					ts(e) || s("invalid pick target");
					const t = Object.getOwnPropertyDescriptors(e);
					Object.values(t).some((e) => !("value" in e)) && s("invalid pick target");
					const r = t.paneIndex?.value, n = t.priceScaleId?.value;
					void 0 !== r && (!Number.isSafeInteger(r) || r < 0) && s("invalid pick pane"), void 0 === n || L(n) || s("invalid pick scale");
				}
				if ("price" === i.type) {
					const { timeKey: t, anchor: r } = i;
					void 0 === t || "string" == typeof t && t !== i.key && "timestamp" === e.find((e) => e.key === t)?.type && !e.some((e) => e !== i && "price" === e.type && e.timeKey === t) || s("timeKey must name a declared timestamp input no other price pairs with"), void 0 !== r && ("boolean" != typeof r || r && void 0 === t) && s("an anchor needs a boolean and a timeKey");
				}
			} else if ("string" == typeof i.default && "string" == typeof n || s("expected text"), "session" !== i.type || $t(i.default) && $t(n) || s("expected a session such as 0930-1600:23456"), "symbol" === i.type && void 0 !== i.exchangeKey) {
				"string" == typeof i.exchangeKey && i.exchangeKey && i.exchangeKey !== i.key || s("invalid exchange field");
				const r = Object.getOwnPropertyDescriptor(t, i.exchangeKey);
				!r || "value" in r && "string" == typeof r.value || s(`expected text in "${i.exchangeKey}"`);
				const n = e.find((e) => e.key === i.exchangeKey);
				n && "string" != typeof n.default && s("exchange field must default to text");
			}
		}
	}
	var rs = [
		{
			label: "Solid",
			value: "solid"
		},
		{
			label: "Dashed",
			value: "dashed"
		},
		{
			label: "Dotted",
			value: "dotted"
		}
	];
	function ns(e) {
		return {
			color: e.colorKey ?? `${e.key}:color`,
			width: `${e.key}:width`,
			lineStyle: `${e.key}:lineStyle`,
			opacity: `${e.key}:opacity`,
			type: `${e.key}:type`
		};
	}
	function os(e) {
		const t = [];
		for (const i of e.plots) {
			const s = ns(i), r = e.inputs.find((e) => e.key === i.colorKey), n = "string" == typeof r?.default ? r.default : i.style?.color ?? "#4f8cff";
			t.push({
				key: s.color,
				type: "color",
				label: i.title,
				default: n,
				group: i.title
			}), t.push({
				key: s.opacity,
				type: "number",
				label: "Opacity",
				default: 100,
				min: 0,
				max: 100,
				step: 1,
				group: i.title
			}), t.push({
				key: s.width,
				type: "number",
				label: "Thickness",
				default: i.style?.lineWidth ?? 1.5,
				min: .5,
				max: 8,
				step: .5,
				group: i.title
			}), t.push({
				key: s.lineStyle,
				type: "select",
				label: "Line style",
				default: i.style?.lineStyle ?? "solid",
				options: rs,
				group: i.title
			}), t.push({
				key: s.type,
				type: "select",
				label: "Plot style",
				default: i.type,
				options: as,
				group: i.title
			});
		}
		return t;
	}
	var as = [
		{
			label: "Line",
			value: "line"
		},
		{
			label: "Line with markers",
			value: "line-markers"
		},
		{
			label: "Step line",
			value: "step"
		},
		{
			label: "Area",
			value: "area"
		},
		{
			label: "Histogram",
			value: "histogram"
		},
		{
			label: "Columns",
			value: "column"
		}
	];
	var hs = /* @__PURE__ */ new Map();
	function ds(e) {
		const t = hs.get(e);
		if (void 0 === t) throw new Error(`openalgo-charts: unknown indicator "${e}", did you import 'openalgo-charts/indicators'?`);
		return t;
	}
	function us(e) {
		return hs.has(e);
	}
	function ps(e) {
		ss(e.inputs, {});
		const t = Object.fromEntries(e.inputs.map((e) => [e.key, e.default]));
		for (const i of e.inputs) "symbol" !== i.type || void 0 === i.exchangeKey || Object.prototype.hasOwnProperty.call(t, i.exchangeKey) || Object.defineProperty(t, i.exchangeKey, {
			value: "",
			enumerable: !0,
			writable: !0,
			configurable: !0
		});
		return t;
	}
	function bs(e, t) {
		const i = [...new Set(t.filter((e) => void 0 !== e))], s = 1 === i.length ? null : new AbortController(), r = s?.signal ?? i[0];
		return new Promise((t, n) => {
			let o = !1;
			const a = /* @__PURE__ */ new Map(), l = (e) => {
				o || (o = !0, (() => {
					for (const [e, t] of a) e.removeEventListener("abort", t);
					a.clear();
				})(), e());
			}, h = (e) => {
				l(() => {
					n(e.reason), s?.abort(e.reason);
				});
			}, c = i.find((e) => e.aborted);
			if (c) h(c);
			else {
				for (const e of i) {
					const t = () => h(e);
					a.set(e, t), e.addEventListener("abort", t, { once: !0 });
				}
				try {
					Promise.resolve(e(r)).then((e) => l(() => t(e)), (e) => l(() => n(e)));
				} catch (e) {
					l(() => n(e));
				}
			}
		});
	}
	var gs = /* @__PURE__ */ new Set([
		"everyUpdate",
		"oncePerBar",
		"onBarClose",
		"once"
	]);
	function vs(e, t) {
		const i = {};
		for (const s of Object.keys(e)) Object.defineProperty(i, s, {
			value: Object.freeze(e[s].slice(0, t)),
			enumerable: !0
		});
		return Object.freeze(i);
	}
	function ys(e, t, i, s) {
		return s === e.length - 1 ? {
			bars: e,
			values: t,
			settings: i,
			index: s
		} : {
			bars: Object.freeze(e.slice(0, s + 1)),
			values: vs(t, s + 1),
			settings: i,
			index: s
		};
	}
	function ws(e, t) {
		return t ? (e) => t.bars[t.sourceIndex[e]].time : (t) => e[t].time;
	}
	var xs = class {
		constructor(e) {
			Object.defineProperty(this, "_entries", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_legacyCalculations", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new WeakSet()
			}), Object.defineProperty(this, "_initialized", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_native", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_sourceId", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_historyRevision", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_revision", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_replaying", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_epoch", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			});
			const t = /* @__PURE__ */ new Set();
			for (const i of e) {
				const e = i.frequency;
				if (void 0 !== e) {
					if (!gs.has(e)) throw new TypeError("Indicator alert frequency is invalid");
					if ("string" != typeof i.id || "" === i.id.trim()) throw new TypeError("Explicit indicator alert id must be nonempty");
					if (t.has(i.id)) throw new TypeError("Explicit indicator alert ids must be unique");
					t.add(i.id), this._entries.push({
						spec: Object.freeze({
							...i,
							frequency: e
						}),
						onceSpent: !1,
						perBarTime: -1 / 0,
						closedTime: -1 / 0,
						failedCloses: /* @__PURE__ */ new Set(),
						busy: !1
					});
				}
			}
		}
		evaluate(e, t) {
			if (0 === this._entries.length || !e.current()) return;
			const i = e.calculation.execution, s = void 0 !== i, r = "replay" === i?.provenance, n = !this._initialized || this._native !== s || s && (i.sourceId !== this._sourceId || i.historyRevision !== this._historyRevision || r !== this._replaying);
			if (s) {
				if (!n && void 0 !== this._revision && i.revision <= this._revision) return;
			} else {
				if (this._legacyCalculations.has(e.calculation)) return;
				this._legacyCalculations.add(e.calculation);
			}
			const o = ++this._epoch;
			this._initialized = !0, this._native = s, this._sourceId = i?.sourceId, this._historyRevision = i?.historyRevision, this._revision = i?.revision, this._replaying = r;
			const a = e.sampled?.bars ?? e.bars, l = ws(e.bars, e.sampled), h = a[a.length - (e.calculation.barState.isConfirmed ? 1 : 2)]?.time ?? -1 / 0, c = e.refresh || "refresh" === i?.change, d = s ? "live" === i.provenance : e.tailOnly;
			if (n || !c && !d) return void this._seed(h);
			if (c || !d || 0 === e.bars.length) return;
			const u = Object.freeze(e.bars.map((e) => Object.freeze({ ...e }))), _ = vs(e.values), p = Object.freeze({ ...e.settings }), f = () => this._epoch === o && e.current();
			if (!f()) return;
			let m, b = !1;
			const g = u.length - 1, v = Math.min(e.from, g), y = [];
			for (let t = v; t <= g; t++) (t > v ? l(t) !== l(t - 1) : v === e.from || l(t) === a[a.length - 1].time) && y.push(t);
			for (const e of this._entries) {
				if (!f()) return;
				if (e.busy) continue;
				const i = "onBarClose" === e.spec.frequency, s = i ? this._closeIndices(e, l, g, h) : y;
				for (const r of s) {
					if (!f()) return;
					if ("once" === e.spec.frequency && e.onceSpent) break;
					const s = u[r].time, n = l(r);
					if ("oncePerBar" === e.spec.frequency && n <= e.perBarTime) continue;
					const o = ys(u, _, p, r);
					let a = !1;
					e.busy = !0;
					try {
						if (!f()) return;
						const l = e.spec.when(o);
						if (!f()) return;
						if (!l) {
							i && this._judgeClose(e, n);
							continue;
						}
						const h = "function" == typeof e.spec.message ? e.spec.message(o) : e.spec.message ?? e.spec.title;
						if (!f()) return;
						const c = {
							alertId: e.spec.id,
							title: e.spec.title,
							message: h,
							time: s,
							index: r
						};
						if ("once" === e.spec.frequency && (e.onceSpent = !0), "oncePerBar" === e.spec.frequency && (e.perBarTime = n), i && this._judgeClose(e, n), a = !0, t(c), !f()) return;
					} catch (t) {
						if (!f()) return;
						i && !a && e.failedCloses.add(n), b || (b = !0, m = t);
					} finally {
						e.busy = !1;
					}
				}
			}
			if (b && f()) throw m;
		}
		redate(e, t) {
			for (const i of this._entries) i.perBarTime === e && (i.perBarTime = t), i.closedTime === e && (i.closedTime = t);
		}
		_seed(e) {
			for (const t of this._entries) t.perBarTime = e, t.closedTime = e, t.failedCloses.clear();
		}
		_judgeClose(e, t) {
			e.closedTime = Math.max(e.closedTime, t), e.failedCloses.delete(t);
		}
		_closeIndices(e, t, i, s) {
			const r = [], n = /* @__PURE__ */ new Set();
			for (let o = 0, a = 0; o <= i && (a = t(o)) <= s; o++) (a > e.closedTime || e.failedCloses.has(a)) && !n.has(a) && r.push(o), n.add(a);
			for (const t of e.failedCloses) n.has(t) || e.failedCloses.delete(t);
			return r;
		}
	};
	function Ss(e) {
		return "string" == typeof e && e.trim().length > 0;
	}
	function Ps(e) {
		if ("object" != typeof e || null === e) return !1;
		const t = Object.getOwnPropertyDescriptor(e, "kind");
		return void 0 !== t && "value" in t && "indicator" === t.value;
	}
	function Os(e) {
		if (!ts(e)) throw new TypeError("Study source reference must be a plain object.");
		const t = Reflect.ownKeys(e);
		if (3 !== t.length || !t.every((e) => "kind" === e || "instanceId" === e || "plotKey" === e)) throw new TypeError("Study source reference requires only kind, instanceId and plotKey.");
		const i = Object.getOwnPropertyDescriptor(e, "kind"), s = Object.getOwnPropertyDescriptor(e, "instanceId"), r = Object.getOwnPropertyDescriptor(e, "plotKey");
		if (!(i && s && r && "value" in i && "value" in s && "value" in r)) throw new TypeError("Study source reference fields must be own data properties.");
		if ("indicator" !== i.value || !Ss(s.value) || !Ss(r.value)) throw new TypeError("Study source reference requires nonempty instanceId and plotKey strings.");
		return {
			kind: "indicator",
			instanceId: s.value,
			plotKey: r.value
		};
	}
	function ks(e) {
		if (!ts(e)) throw new TypeError("Indicator settings must be a plain object.");
		const t = {};
		for (const i of Object.keys(e)) {
			const s = Object.getOwnPropertyDescriptor(e, i);
			if (!("value" in s)) throw new TypeError(`Indicator settings property "${i}" must be a data property.`);
			const r = s.value;
			Object.defineProperty(t, i, {
				value: Ps(r) ? Os(r) : r,
				writable: !0,
				configurable: !0,
				enumerable: !0
			});
		}
		return t;
	}
	function Is(e, t) {
		let i = e.length;
		for (e.push(t); i > 0;) {
			const s = i - 1 >>> 1;
			if (e[s] <= t) break;
			e[i] = e[s], i = s;
		}
		e[i] = t;
	}
	function Ms(e) {
		const t = e[0], i = e.pop();
		if (0 === e.length) return t;
		let s = 0;
		for (; 2 * s + 1 < e.length;) {
			let t = 2 * s + 1;
			if (t + 1 < e.length && e[t + 1] < e[t] && t++, e[t] >= i) break;
			e[s] = e[t], s = t;
		}
		return e[s] = i, t;
	}
	function Ts(e) {
		const t = /* @__PURE__ */ new Map();
		for (let i = 0; i < e.length; i++) {
			const s = e[i].id;
			if (!Ss(s)) throw new TypeError("Indicator instance id must be a nonempty string.");
			if (t.has(s)) throw new TypeError(`Duplicate indicator instance id "${s}".`);
			t.set(s, i);
		}
		const i = /* @__PURE__ */ new Map(), s = e.map(() => []), r = e.map(() => 0);
		for (let n = 0; n < e.length; n++) {
			const o = e[n], a = ks(o.settings);
			for (const e of Object.keys(a)) if (Ps(a[e]) && !o.descriptor.inputs.some((t) => t.key === e && "source" === t.type && !0 === t.allowStudyOutputs)) throw new TypeError(`Indicator "${o.id}" input "${e}" does not support study sources.`);
			const l = [], h = /* @__PURE__ */ new Set();
			for (const i of o.descriptor.inputs) {
				if ("source" !== i.type) continue;
				const s = Object.getOwnPropertyDescriptor(a, i.key), r = s ? s.value : i.default;
				if ("string" == typeof r) continue;
				const n = Os(r);
				if (!0 !== i.allowStudyOutputs) throw new TypeError(`Indicator "${o.id}" input "${i.key}" does not support study sources.`);
				if (n.instanceId === o.id) throw new TypeError(`Indicator "${o.id}" cannot reference itself (self dependency).`);
				const c = t.get(n.instanceId);
				if (void 0 !== c) {
					const t = e[c].descriptor.plots.filter((e) => e.key === n.plotKey);
					if (1 !== t.length) throw new TypeError(`Study source plot "${n.plotKey}" must identify one declared plot on "${n.instanceId}".`);
					if (void 0 !== t[0].ohlc) throw new TypeError(`Study source plot "${n.plotKey}" must be scalar, without an OHLC mapping.`);
					h.add(c);
				}
				l.push({
					inputKey: i.key,
					source: n,
					available: void 0 !== c
				});
			}
			i.set(o.id, l), r[n] = h.size;
			for (const e of h) s[e].push(n);
		}
		const n = [], o = [];
		for (let t = 0; t < e.length; t++) 0 === r[t] && Is(n, t);
		for (; n.length > 0;) {
			const t = Ms(n);
			o.push(e[t].id);
			for (const e of s[t]) r[e]--, 0 === r[e] && Is(n, e);
		}
		if (o.length !== e.length) throw new TypeError("Study source references contain a dependency cycle.");
		return {
			order: o,
			dependencies: i
		};
	}
	var Cs = [
		"removable",
		"configurable",
		"movable",
		"listed"
	];
	function js(e) {
		if (null === e || "object" != typeof e || Array.isArray(e)) throw new TypeError("Invalid indicator policy");
		const t = {};
		for (const i of Cs) {
			const s = e[i];
			if (void 0 !== s) {
				if ("boolean" != typeof s) throw new TypeError(`Invalid indicator policy flag: ${i}`);
				s || (t[i] = !1);
			}
		}
		return Object.freeze(t);
	}
	function As(e) {
		if (void 0 !== e.fontSize && ("number" != typeof e.fontSize || !Number.isFinite(e.fontSize) || e.fontSize <= 0)) throw new TypeError("Text fontSize must be a positive finite number");
		if (void 0 !== e.fontFamily && ("string" != typeof e.fontFamily || "" === e.fontFamily.trim())) throw new TypeError("Text fontFamily must be a nonempty CSS font-family list");
		for (const t of ["bold", "italic"]) if (void 0 !== e[t] && "boolean" != typeof e[t]) throw new TypeError(`Text ${t} must be boolean`);
		if (void 0 !== e.textAlign && ![
			"left",
			"center",
			"right"
		].includes(e.textAlign)) throw new TypeError("Text textAlign must be left, center or right");
	}
	function Ls(e) {
		return void 0 !== e.fontSize || void 0 !== e.fontFamily || void 0 !== e.bold || void 0 !== e.italic || void 0 !== e.textAlign;
	}
	function Ns(e, t, i, s = !1) {
		return `${e?.italic ? "italic " : ""}${e?.bold ?? s ? "600 " : ""}${function(e) {
			const t = String(e), i = t.indexOf("e");
			if (i < 0) return t;
			const s = t.slice(0, i), r = Number(t.slice(i + 1)), n = s.replace(".", ""), o = (s.indexOf(".") < 0 ? s.length : s.indexOf(".")) + r;
			return o <= 0 ? `0.${"0".repeat(-o)}${n}` : o >= n.length ? n + "0".repeat(o - n.length) : `${n.slice(0, o)}.${n.slice(o)}`;
		}(t)}px ${e?.fontFamily ?? i}`;
	}
	var Rs = {
		tiny: 6,
		small: 9,
		medium: 12,
		big: 16
	};
	function Fs(e) {
		return Rs[e];
	}
	function zs(e, t) {
		return Math.max(4, Math.min(Rs[e], Math.floor(t)));
	}
	function Es(e, t, i, s, r, n) {
		const o = r / 2;
		switch (e.fillStyle = n, e.strokeStyle = n, e.beginPath(), t) {
			case "arrowUp":
			case "triangleUp":
				e.moveTo(i, s - o), e.lineTo(i + o, s + o), e.lineTo(i - o, s + o), e.closePath(), e.fill();
				break;
			case "arrowDown":
			case "triangleDown":
				e.moveTo(i, s + o), e.lineTo(i + o, s - o), e.lineTo(i - o, s - o), e.closePath(), e.fill();
				break;
			case "circle":
				e.arc(i, s, o, 0, 2 * Math.PI), e.fill();
				break;
			case "square":
				e.fillRect(i - o, s - o, r, r);
				break;
			case "diamond":
				e.moveTo(i, s - o), e.lineTo(i + o, s), e.lineTo(i, s + o), e.lineTo(i - o, s), e.closePath(), e.fill();
				break;
			case "flag":
				e.fillRect(i - 1, s - o, Math.max(1, r / 8), r), e.fillRect(i, s - o, o, .8 * o);
				break;
			case "cross": {
				const t = Math.max(1, Math.round(r / 6));
				e.fillRect(i - o, s - Math.floor(t / 2), r, t), e.fillRect(i - Math.floor(t / 2), s - o, t, r);
				break;
			}
			case "xcross": e.lineWidth = Math.max(1, Math.round(r / 6)), e.moveTo(i - o, s - o), e.lineTo(i + o, s + o), e.moveTo(i + o, s - o), e.lineTo(i - o, s + o), e.stroke();
		}
	}
	var Bs = 1.35;
	function $s(e, t, i, s, r) {
		const n = .5 * r, o = s.indexOf("\n") < 0 ? void 0 : s.split("\n");
		let a = e.measureText(void 0 === o ? s : o[0]).width;
		if (void 0 !== o) for (let t = 1; t < o.length; t++) a = Math.max(a, e.measureText(o[t]).width);
		const l = r * Bs, h = a + 2 * n, c = r + .64 * r + (void 0 === o ? 0 : l * (o.length - 1)), d = .42 * r;
		return {
			lines: o,
			lh: l,
			w: h,
			h: c,
			tail: d,
			textW: a,
			top: t ? i + d : i - d - c
		};
	}
	function Ds(e, t, i, s, r, n, o) {
		e.font = `600 ${o}px system-ui, sans-serif`;
		Ws(e, t, i, s, r, n, o, $s(e, t, s, r, o));
	}
	function Ws(e, t, i, s, r, n, o, a, l) {
		const { w: h, h: c, top: d, tail: u, lines: _, lh: p, textW: f } = a;
		e.fillStyle = n, e.beginPath(), ne(e, i - h / 2, d, h, c, Math.min(.3 * o, c / 2)), e.fill();
		const m = t ? d + 1 : d + c - 1;
		e.beginPath(), e.moveTo(i, s), e.lineTo(i - u, m), e.lineTo(i + u, m), e.closePath(), e.fill(), e.fillStyle = l?.textColor ?? Q(n), e.textAlign = l?.textAlign ?? "center", e.textBaseline = "middle";
		const b = "left" === l?.textAlign ? i - f / 2 : "right" === l?.textAlign ? i + f / 2 : i;
		if (void 0 === _) return void e.fillText(r, b, d + c / 2);
		const g = d + c / 2 - p * (_.length - 1) / 2;
		for (let t = 0; t < _.length; t++) e.fillText(_[t], b, g + p * t);
	}
	function qs(e, t) {
		let i = 0, s = e.length - 1;
		for (; i <= s;) {
			let r = i + s >> 1;
			const n = e[r].time;
			if (n === t) {
				for (; r + 1 < e.length && e[r + 1].time === t;) r++;
				return e[r];
			}
			n < t ? i = r + 1 : s = r - 1;
		}
	}
	var Vs = "system-ui, sans-serif";
	var Hs = {
		aboveBar: -1,
		paneBottom: -1,
		belowBar: 1,
		paneTop: 1
	};
	var Gs = (e) => "labelUp" === e.shape || "labelDown" === e.shape;
	var Us = (e) => Ls(e) || void 0 !== e.textColor;
	var Ks = (e) => e.fontSize ?? Math.max(9, Fs(e.size));
	function Ys(e, t, i, s) {
		return Gs(e) ? (t + i) / 2 : "text" === e.shape ? t / 2 : Math.max(t, s) / 2;
	}
	function Xs(e, t, i, s, r, n, o) {
		const a = Ys(e, n, r, s), l = function(e) {
			let t = 0;
			for (let i = e.indexOf("\n"); i >= 0; i = e.indexOf("\n", i + 1)) t++;
			return t;
		}(e.text ?? "");
		if (Gs(e)) {
			const s = r + .64 * r + (0 === l ? 0 : r * Bs * l), n = .42 * r;
			return "labelUp" === e.shape ? {
				l: t - a,
				r: t + a,
				t: i,
				b: i + n + s
			} : {
				l: t - a,
				r: t + a,
				t: i - n - s,
				b: i
			};
		}
		const h = r + l * r * Bs, c = o ? i + s : i - s - h;
		return "text" === e.shape ? {
			l: t - a,
			r: t + a,
			t: c,
			b: c + h
		} : {
			l: t - a,
			r: t + a,
			t: Math.min(i - s / 2, c),
			b: Math.max(i + s / 2, c + h)
		};
	}
	function Js(e, t, i, s, r, n) {
		if (e.length > 32) {
			let t = 0;
			for (const i of e) i.r > r && (e[t++] = i);
			e.length = t;
		}
		let o = 0;
		for (let r = !0; r;) {
			r = !1;
			for (const a of e) if (!(a.r <= i.l || a.l >= i.r || a.b <= i.t + o || a.t >= i.b + o) && (o = t < 0 ? a.t - s - i.b : a.b + s - i.t, r = !0, Math.abs(o) > n)) {
				o = 0, r = !1;
				break;
			}
		}
		return i.t += o, i.b += o, e.push(i), o;
	}
	function Zs(e, t, i, s, r, n) {
		return "paneTop" === e.position ? i / 2 + 4 * n.dpr + s : "paneBottom" === e.position ? n.plotHeight * n.dpr - i / 2 - 4 * n.dpr - s : "atPrice" === e.position && void 0 !== e.price ? r.priceToY(e.price) * n.dpr : void 0 !== t && "aboveBar" === e.position ? r.priceToY(t.high) * n.dpr - i - s : void 0 !== t && "belowBar" === e.position ? r.priceToY(t.low) * n.dpr + i + s : void 0 !== t ? r.priceToY((t.open + t.close) / 2) * n.dpr : NaN;
	}
	function Qs(e, t, i, s, r, n, o, a, l, h, c, d) {
		const u = l ? r + n : r - n;
		let _, p = 0;
		if (h) {
			a && (e.font = Ns(i, o, Vs, c));
			let h = s - n / 2, d = s + n / 2, f = r - n / 2, m = r + n / 2;
			if (a && void 0 !== i.text) if (c) _ = $s(e, "labelUp" === i.shape, r, i.text, o), h = s - _.w / 2, d = s + _.w / 2, f = Math.min(r, _.top), m = Math.max(r, _.top + _.h);
			else {
				const t = i.text.split("\n");
				for (const i of t) p = Math.max(p, e.measureText(i).width);
				const r = o + (t.length - 1) * o * Bs;
				h = Math.min(h, s - p / 2), d = Math.max(d, s + p / 2), f = Math.min(f, l ? u : u - r), m = Math.max(m, l ? u + r : u);
			}
			if (c || [
				h,
				d,
				f,
				m
			].every(Number.isFinite) || (a = !1, h = s - n / 2, d = s + n / 2, f = r - n / 2, m = r + n / 2), ![
				h,
				d,
				f,
				m
			].every(Number.isFinite) || d < 0 || h > t.plotWidth * t.dpr || m < 0 || f > t.plotHeight * t.dpr) return;
			e.save(), e.beginPath(), e.rect(0, 0, t.plotWidth * t.dpr, t.plotHeight * t.dpr), e.clip();
		}
		const f = h ? {
			width: t.plotWidth,
			height: t.plotHeight
		} : void 0;
		if ("labelUp" === i.shape || "labelDown" === i.shape) return void 0 !== i.text && (_ ? Ws(e, "labelUp" === i.shape, s, r, i.text, i.color, o, _, i) : Ds(e, "labelUp" === i.shape, s, r, i.text, i.color, o)), void 0 !== i.id && d.push({
			id: i.id,
			x: s / t.dpr,
			y: r / t.dpr,
			clip: f
		}), void (h && e.restore());
		if (Es(e, i.shape, s, r, n, i.color), a && void 0 !== i.text) {
			e.fillStyle = i.textColor ?? i.color, e.font = Ns(i, o, Vs), e.textAlign = i.textAlign ?? "center", e.textBaseline = l ? "top" : "bottom";
			const t = "left" === i.textAlign ? s - p / 2 : "right" === i.textAlign ? s + p / 2 : s;
			if (i.text.indexOf("\n") < 0) e.fillText(i.text, t, u);
			else {
				const s = i.text.split("\n"), r = o * Bs;
				for (let i = 0; i < s.length; i++) e.fillText(s[l ? i : s.length - 1 - i], t, l ? u + r * i : u - r * i);
			}
		}
		void 0 !== i.id && d.push({
			id: i.id,
			x: s / t.dpr,
			y: r / t.dpr,
			clip: f
		}), h && e.restore();
	}
	var er = class {
		constructor(e, t, i) {
			Object.defineProperty(this, "_seriesId", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_fallbackBars", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_priceScale", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_markers", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_lastPositions", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_widths", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_widthDpr", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_fontWidths", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_anyStyled", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), this._seriesId = e, this._fallbackBars = t, this._priceScale = i;
		}
		attached(e) {
			this._host = e;
		}
		detached() {
			this._host = null, this._lastPositions = [];
		}
		zOrder() {
			return "normal";
		}
		setMarkers(e) {
			for (const t of e) if (As(t), void 0 !== t.textColor && ("string" != typeof t.textColor || "" === t.textColor.trim())) throw new TypeError("Marker textColor must be a nonempty color string");
			this._markers = e.slice().sort((e, t) => e.time - t.time), this._lastPositions = [], this._widths = /* @__PURE__ */ new Map(), this._anyStyled = this._markers.some(Us), this._host?.requestUpdate();
		}
		_textWidth(e, t, i, s) {
			this._widthDpr !== s && (this._widths = /* @__PURE__ */ new Map(), this._widthDpr = s);
			let r = this._widths.get(t);
			if (void 0 !== r) return r;
			const n = Ns(t, i, Vs, Gs(t)), o = t.text ?? "", a = n + "\n" + o;
			if (r = this._fontWidths.get(a), void 0 === r) {
				e.font = n, r = 0;
				for (const t of o.split("\n")) r = Math.max(r, e.measureText(t).width);
				this._fontWidths.size >= 512 && this._fontWidths.clear(), this._fontWidths.set(a, r);
			}
			return this._widths.set(t, r), r;
		}
		draw(e, t) {
			if (this._lastPositions = [], 0 === this._markers.length) return;
			const i = function(e, t) {
				let i, s;
				return (r) => {
					const n = qs(e, r);
					if (void 0 !== n && Number.isFinite(n.close)) return n;
					if (void 0 === t) return;
					i ?? (i = t());
					const o = qs(i, r);
					if (void 0 !== o) return o;
					if (void 0 === s) {
						s = /* @__PURE__ */ new Map();
						for (const e of i) s.set(e.time, e);
					}
					return s.get(r);
				};
			}(t.dataLayer.seriesBars(this._seriesId), this._fallbackBars), s = this._priceScale?.() ?? t.priceScale, r = t.timeScale.visibleRange(), n = /* @__PURE__ */ new Map(), o = this._markers, a = t.dpr, l = (e) => {
				if (void 0 === e.text || void 0 === Hs[e.position]) return NaN;
				const t = Ks(e) * a;
				return Number.isFinite(t) && t > 0 ? t : NaN;
			};
			e.save();
			const h = function(e, t, i, s, r, n) {
				const o = i.dpr;
				let a = e.length;
				for (let t = 0; t < e.length; t++) {
					const r = e[t], l = i.dataLayer.timeToIndex(r.time);
					if (void 0 !== l) {
						if (Us(r)) {
							const e = Ks(r) * o, t = void 0 !== r.text && Number.isFinite(e) && e > 0 ? n(r, e) : 0;
							if (i.timeScale.indexToX(l) * o + Math.max(t, 16 * o) < 0) continue;
						} else if (l < s.from - 1) continue;
						a = t;
						break;
					}
				}
				if (a === e.length) return null;
				for (; a > 0 && e[a - 1].time === e[a].time;) a--;
				const l = Math.max(0, 256 * Math.floor((a - 256) / 256));
				let h = 0;
				for (let o = l; o < e.length; o++) {
					const a = e[o], l = i.dataLayer.timeToIndex(a.time);
					if (void 0 === l) continue;
					if (!Us(a) && l > s.to + 1) {
						if (t) continue;
						break;
					}
					const c = r(a);
					c > 0 && (h = Math.max(h, n(a, c)));
				}
				let c = l, d = -1 / 0;
				for (let t = l; t < a; t++) {
					const s = e[t], a = i.dataLayer.timeToIndex(s.time);
					if (void 0 === a) continue;
					const u = i.timeScale.indexToX(a) * o;
					u - h >= d && (t === l || e[t - 1].time !== s.time) && (c = t);
					const _ = r(s);
					_ > 0 && (d = Math.max(d, u + n(s, _)));
				}
				if (a > c) {
					const t = i.dataLayer.timeToIndex(e[a].time);
					void 0 !== t && i.timeScale.indexToX(t) * o - h >= d && (c = a);
				}
				return {
					start: c,
					widest: h
				};
			}(o, this._anyStyled, t, r, l, (i, s) => Ys(i, this._textWidth(e, i, s, a), s, zs(i.size, t.timeScale.barSpacing) * a));
			if (null === h) return void e.restore();
			const { start: c, widest: d } = h, u = 2 * a, _ = {
				[-1]: [],
				1: []
			};
			for (let h = c; h < o.length; h++) {
				const c = o[h], p = Us(c), f = t.dataLayer.timeToIndex(c.time);
				if (void 0 === f) continue;
				if (!p && f > r.to + 1) {
					if (this._anyStyled) continue;
					break;
				}
				const m = l(c), b = !p && f < r.from - 1;
				if (b && !(m > 0)) continue;
				const g = "paneTop" === c.position || "paneBottom" === c.position ? void 0 : i(c.time), v = zs(c.size, t.timeScale.barSpacing) * t.dpr, y = t.timeScale.indexToX(f) * t.dpr, w = n.get(c.time) ?? 0;
				let x = Zs(c, g, v, (v + 4 * t.dpr) * w, s, t);
				if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
				n.set(c.time, w + 1);
				const S = Ks(c) * t.dpr, P = "labelUp" === c.shape || "labelDown" === c.shape, O = Number.isFinite(S) && S > 0;
				if (P && !O) continue;
				const k = O && void 0 !== c.text, I = "belowBar" === c.position || "paneTop" === c.position;
				if (m > 0) {
					const t = Hs[c.position], i = Xs(c, y, x, v, m, this._textWidth(e, c, m, a), I);
					Number.isFinite(i.l) && Number.isFinite(i.r) && Number.isFinite(i.t) && Number.isFinite(i.b) && (x += Js(_[t], t, i, u, y - d, 5 * (i.b - i.t + u)));
				}
				b || Qs(e, t, c, y, x, v, S, k, I, p, P, this._lastPositions);
			}
			e.restore();
		}
		hitTest(e, t) {
			let i = null;
			for (const s of this._lastPositions) {
				if (s.clip && (e < 0 || t < 0 || e > s.clip.width || t > s.clip.height)) continue;
				const r = Math.hypot(s.x - e, s.y - t);
				r <= 8 && (null === i || r < i.distance) && (i = {
					externalId: s.id,
					zOrder: "normal",
					distance: r,
					cursor: "pointer"
				});
			}
			return i;
		}
	};
	function tr(e, t) {
		return e === t || void 0 !== e && void 0 !== t && e.topValue === t.topValue && e.bottomValue === t.bottomValue && e.topColor === t.topColor && e.bottomColor === t.bottomColor;
	}
	var ir = class {
		constructor(e) {
			Object.defineProperty(this, "_points", {
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
			}), Object.defineProperty(this, "_visible", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !0
			}), this._opts = {
				opacity: .12,
				...e
			};
		}
		attached(e) {
			this._host = e;
		}
		detached() {
			this._host = null;
		}
		zOrder() {
			return "bottom";
		}
		autoscaleInfo() {
			return null;
		}
		setPoints(e) {
			this._points = e.slice(), this._host?.requestUpdate();
		}
		setOptions(e) {
			this._opts = {
				...this._opts,
				...e
			}, this._host?.requestUpdate();
		}
		setVisible(e) {
			this._visible = e, this._host?.requestUpdate();
		}
		draw(e, t) {
			if (!this._visible || this._points.length < 2) return;
			const i = t.dpr, s = (e) => t.timeScale.indexToX(e) * i, r = (e) => t.priceScale.priceToY(e) * i, n = /* @__PURE__ */ new Map();
			let o;
			const a = (t) => {
				let i = t.topValue, s = t.bottomValue;
				if (void 0 === i || void 0 === s) {
					if (void 0 === o) {
						let e = 1 / 0, t = -1 / 0;
						for (const i of this._points) for (const s of [i.a, i.b]) null !== s && Number.isFinite(s) && (e = Math.min(e, s), t = Math.max(t, s));
						o = {
							min: e,
							max: t
						};
					}
					i ?? (i = o.max), s ?? (s = o.min);
				}
				const a = r(i), l = a + (r(s) - a || 1), h = JSON.stringify([
					a,
					l,
					t.topColor,
					t.bottomColor
				]);
				let c = n.get(h);
				return void 0 === c && (c = e.createLinearGradient(0, a, 0, l), c.addColorStop(0, t.topColor), c.addColorStop(1, t.bottomColor), n.set(h, c)), c;
			};
			e.save(), e.globalAlpha = this._opts.opacity ?? .12;
			let l = null;
			const h = () => {
				if (null !== l && l.xs.length >= 2) {
					e.beginPath(), e.moveTo(l.xs[0], l.top[0]);
					for (let t = 1; t < l.xs.length; t++) e.lineTo(l.xs[t], l.top[t]);
					for (let t = l.xs.length - 1; t >= 0; t--) e.lineTo(l.xs[t], l.bot[t]);
					e.closePath(), void 0 === l.gradient || void 0 !== l.color ? (e.fillStyle = l.color ?? (l.up ? this._opts.colorUp : this._opts.colorDown), e.fill()) : (e.fillStyle = a(l.gradient), e.fill());
				}
				l = null;
			};
			for (let e = 0; e < this._points.length; e++) {
				const t = this._points[e];
				if (null === t.a || null === t.b || !Number.isFinite(t.a) || !Number.isFinite(t.b)) {
					h();
					continue;
				}
				const i = t.a >= t.b, n = s(t.index), o = r(t.a), a = r(t.b), c = t.gradient ?? this._opts.gradient;
				if (null === l || l.up !== i || l.color === t.color && (void 0 !== t.color || tr(l.gradient, c))) {
					if (null !== l && l.up !== i) {
						const n = this._points[e - 1];
						if (void 0 !== n && null !== n.a && null !== n.b) {
							const e = n.a - n.b, o = t.a - t.b, a = e === o ? 0 : e / (e - o), d = s(n.index + (t.index - n.index) * a), u = r(n.a + (t.a - n.a) * a);
							l.xs.push(d), l.top.push(u), l.bot.push(u), h(), l = {
								up: i,
								color: t.color,
								gradient: c,
								xs: [d],
								top: [u],
								bot: [u]
							};
						} else h();
					}
					null === l && (l = {
						up: i,
						color: t.color,
						gradient: c,
						xs: [],
						top: [],
						bot: []
					}), l.xs.push(n), l.top.push(o), l.bot.push(a);
				} else l.xs.push(n), l.top.push(o), l.bot.push(a), h(), l = {
					up: i,
					color: t.color,
					gradient: c,
					xs: [n],
					top: [o],
					bot: [a]
				};
			}
			h(), e.restore();
		}
	};
	function sr(e, t, i) {
		const s = [];
		for (let i = 0; i < e.length; i++) {
			const r = s[s.length - 1];
			r && r[0] === e[i] && r[1] === t[i] || s.push([e[i], t[i]]);
		}
		if (i && s.length > 1 && s[0][0] === s[s.length - 1][0] && s[0][1] === s[s.length - 1][1] && s.pop(), s.length < 2) return null;
		const r = [];
		if (s.length > 2) {
			const e = s.length;
			for (let t = 0; t < (i ? e : e - 1); t++) {
				const n = s[t], o = s[(t + 1) % e], a = s[i ? (t + e - 1) % e : Math.max(0, t - 1)], l = s[i ? (t + 2) % e : Math.min(e - 1, t + 2)], h = [
					n[0] + (o[0] - a[0]) / 6,
					n[1] + (o[1] - a[1]) / 6,
					o[0] - (l[0] - n[0]) / 6,
					o[1] - (l[1] - n[1]) / 6,
					o[0],
					o[1]
				];
				if (!h.every(Number.isFinite)) return null;
				r.push(h);
			}
		}
		return {
			points: s,
			segments: r
		};
	}
	function rr(e, t, i, s, r, n, o, a, l, h) {
		const c = (l?.fontSize ?? 11) * t;
		if (!Number.isFinite(c) || c <= 0) return null;
		e.font = Ns(l, c, "ui-sans-serif, system-ui, sans-serif"), e.textBaseline = "middle", e.textAlign = l?.textAlign ?? "left";
		const d = r.split("\n");
		let u = 0;
		for (const t of d) u = Math.max(u, e.measureText(t).width);
		const _ = 5 * t, p = 3 * t, f = 1.35 * c, m = u + 2 * _, b = f * d.length + 2 * p, g = "center" === a ? i - m / 2 : "right" === a ? i - m : i, v = "top" === l?.verticalAlign ? s : "bottom" === l?.verticalAlign ? s - b : s - b / 2;
		if (h) {
			if (![
				g,
				v,
				m,
				b
			].every(Number.isFinite) || g + m < 0 || g > h.w || v + b < 0 || v > h.h) return null;
			e.save(), e.beginPath(), e.rect(0, 0, h.w, h.h), e.clip();
		}
		e.beginPath(), ne(e, g, v, m, b, 3 * t), e.fillStyle = n, e.fill(), e.fillStyle = o ?? Q(n);
		const y = "center" === l?.textAlign ? g + m / 2 : "right" === l?.textAlign ? g + m - _ : g + _;
		for (let t = 0; t < d.length; t++) e.fillText(d[t], y, v + p + f * (t + .5));
		return h && e.restore(), {
			x: g,
			y: v,
			w: m,
			h: b
		};
	}
	var nr = class {
		constructor(e) {
			Object.defineProperty(this, "_items", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_visible", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !0
			}), Object.defineProperty(this, "_priceScale", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_hits", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), this._priceScale = e;
		}
		attached(e) {
			this._host = e;
		}
		detached() {
			this._host = null, this._hits = [];
		}
		zOrder() {
			return "normal";
		}
		autoscaleInfo() {
			return null;
		}
		setItems(e) {
			for (const t of e) if ("label" === t.kind || "box" === t.kind) {
				if (As(t), void 0 !== t.verticalAlign && ![
					"top",
					"middle",
					"bottom"
				].includes(t.verticalAlign)) throw new TypeError("Drawing verticalAlign must be top, middle or bottom");
				if ("box" === t.kind && void 0 !== t.align && ![
					"left",
					"center",
					"right"
				].includes(t.align)) throw new TypeError("Box align must be left, center or right");
			}
			this._items = e, this._hits = [], this._host?.requestUpdate();
		}
		setVisible(e) {
			this._visible = e, this._hits = [], this._host?.requestUpdate();
		}
		draw(e, t) {
			if (this._hits = [], !this._visible || 0 === this._items.length) return;
			const i = t.dpr, s = t.plotWidth * i, r = t.plotHeight * i, n = t.theme.axisText, o = 200 * i, a = (e) => t.timeScale.indexToX(t.dataLayer.timeToIndexFloat(e.time)) * i, l = this._priceScale?.(t) ?? t.priceScale, h = (e) => l.priceToY(e.price) * i, c = (e, t, i, n) => Math.max(e, i) < 0 || Math.min(e, i) > s || Math.max(t, n) < 0 || Math.min(t, n) > r;
			e.save(), e.lineJoin = "round", e.lineCap = "round";
			for (const t of this._items) {
				if ("label" === t.kind) {
					const l = Ls(t) || void 0 !== t.verticalAlign, c = a(t.at), d = h(t.at);
					if (!l && (c < -o || c > s + o || d < -o || d > r + o)) continue;
					const u = rr(e, i, c, d, t.text, t.color ?? n, t.textColor, t.align ?? "center", t, l ? {
						w: s,
						h: r
					} : void 0);
					u && this._recordHit(t, u, i, l ? {
						w: s,
						h: r
					} : void 0);
					continue;
				}
				const l = t.color ?? n;
				if (e.lineWidth = Math.max(1, Math.round((t.lineWidth ?? 1) * i)), "polyline" === t.kind) {
					const i = t.points;
					if (i.length < 2) continue;
					const n = new Array(i.length), o = new Array(i.length);
					let d = 1 / 0, u = -1 / 0, _ = 1 / 0, p = -1 / 0, f = !0;
					for (let e = 0; e < i.length; e++) {
						if (!Number.isFinite(i[e].time) || !Number.isFinite(i[e].price)) {
							f = !1;
							break;
						}
						const t = a(i[e]), s = h(i[e]);
						if (!Number.isFinite(t) || !Number.isFinite(s)) {
							f = !1;
							break;
						}
						n[e] = t, o[e] = s, t < d && (d = t), t > u && (u = t), s < _ && (_ = s), s > p && (p = s);
					}
					if (!f) continue;
					const m = "smooth" === t.curve, b = m ? sr(n, o, !0 === t.closed) : null;
					if (m && null === b) continue;
					if (b) for (const e of b.segments) for (let t = 0; t < e.length; t += 2) d = Math.min(d, e[t]), u = Math.max(u, e[t]), _ = Math.min(_, e[t + 1]), p = Math.max(p, e[t + 1]);
					const g = m ? e.lineWidth / 2 : 0;
					if (c(d - g, _ - g, u + g, p + g)) continue;
					if (m && (e.save(), e.beginPath(), e.rect(0, 0, s, r), e.clip()), e.beginPath(), e.moveTo(n[0], o[0]), b && b.segments.length > 0) for (const t of b.segments) e.bezierCurveTo(...t);
					else if (b) e.lineTo(b.points[1][0], b.points[1][1]);
					else for (let t = 1; t < i.length; t++) e.lineTo(n[t], o[t]);
					!0 === t.closed && e.closePath(), void 0 !== t.fillColor && (e.globalAlpha = t.opacity ?? .12, e.fillStyle = t.fillColor, e.fill(), e.globalAlpha = 1), e.setLineDash([]), e.strokeStyle = l, e.stroke(), m && e.restore();
					continue;
				}
				let d = a(t.from), u = h(t.from), _ = a(t.to), p = h(t.to);
				if ("box" === t.kind) {
					const n = Ls(t) || void 0 !== t.align || void 0 !== t.verticalAlign;
					if (!n && c(d, u, _, p)) continue;
					if (n && ![
						d,
						u,
						_,
						p
					].every(Number.isFinite)) continue;
					const o = Math.min(d, _), a = Math.min(u, p), h = Math.abs(_ - d), f = Math.abs(p - u);
					if (n && (!Number.isFinite(h) || !Number.isFinite(f))) continue;
					if (n && (e.save(), e.beginPath(), e.rect(0, 0, s, r), e.clip()), void 0 !== t.fillColor && (e.globalAlpha = t.opacity ?? .12, e.fillStyle = t.fillColor, e.fillRect(o, a, h, f), e.globalAlpha = 1), e.setLineDash([]), e.strokeStyle = l, e.strokeRect(o, a, h, f), this._recordHit(t, {
						x: o,
						y: a,
						w: h,
						h: f
					}, i, n ? {
						w: s,
						h: r
					} : void 0), void 0 !== t.text && "" !== t.text) rr(e, i, "left" === t.align ? o : "right" === t.align ? o + h : o + h / 2, "top" === t.verticalAlign ? a : "bottom" === t.verticalAlign ? a + f : a + f / 2, t.text, l, t.textColor, t.align ?? "center", t, n ? {
						w: s,
						h: r
					} : void 0);
					n && e.restore();
					continue;
				}
				if (!0 === t.extendLeft || !0 === t.extendRight) {
					const e = _ - d;
					if (0 === e) u = 0, p = r;
					else {
						const i = (p - u) / e, r = d <= _;
						!0 === t.extendLeft && (r ? (u -= i * d, d = 0) : (p -= i * _, _ = 0)), !0 === t.extendRight && (r ? (p += i * (s - _), _ = s) : (u += i * (s - d), d = s));
					}
				}
				c(d, u, _, p) || (e.setLineDash(be(t.lineStyle, i)), e.strokeStyle = l, e.beginPath(), e.moveTo(d, u), e.lineTo(_, p), e.stroke());
			}
			e.setLineDash([]), this._drawTooltip(e, t, i, s, r, n), e.restore();
		}
		_recordHit(e, t, i, s) {
			const r = e.id ?? e.tooltip;
			if (void 0 === r) return;
			const n = s ? Math.max(0, t.x) : t.x, o = s ? Math.max(0, t.y) : t.y, a = s ? Math.min(s.w, t.x + t.w) : t.x + t.w, l = s ? Math.min(s.h, t.y + t.h) : t.y + t.h;
			s && (a <= n || l <= o) || this._hits.push({
				id: r,
				tooltip: e.tooltip,
				x: n / i,
				y: o / i,
				w: (a - n) / i,
				h: (l - o) / i,
				clipped: void 0 !== s
			});
		}
		_drawTooltip(e, t, i, s, r, n) {
			const o = t.hoverId;
			if (null == o) return;
			const a = this._hits.find((e) => e.id === o && void 0 !== e.tooltip);
			if (void 0 === a?.tooltip) return;
			const l = 8 * i, h = 11 * i * 1.35 * a.tooltip.split("\n").length + 6 * i, c = a.y * i - l - h >= 0 ? a.y * i - l - h / 2 : (a.y + a.h) * i + l + h / 2, d = Math.min(Math.max((a.x + a.w / 2) * i, 0), s);
			c < -h || c > r + h || rr(e, i, d, c, a.tooltip, n, void 0, "center", void 0, a.clipped ? {
				w: s,
				h: r
			} : void 0);
		}
		hitTest(e, t) {
			for (let i = this._hits.length - 1; i >= 0; i--) {
				const s = this._hits[i];
				if (e >= s.x && e <= s.x + s.w && t >= s.y && t <= s.y + s.h) return {
					externalId: s.id,
					zOrder: "normal",
					distance: 0,
					cursor: void 0 === s.tooltip ? "pointer" : "default"
				};
			}
			return null;
		}
	};
	var or = class {
		constructor() {
			Object.defineProperty(this, "_colors", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_anchor", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: NaN
			}), Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_visible", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !0
			});
		}
		attached(e) {
			this._host = e;
		}
		detached() {
			this._host = null;
		}
		zOrder() {
			return "bottom";
		}
		autoscaleInfo() {
			return null;
		}
		setColors(e, t) {
			this._colors = e, this._anchor = t.length > 0 ? t[0].time : NaN, this._host?.requestUpdate();
		}
		setVisible(e) {
			this._visible = e, this._host?.requestUpdate();
		}
		draw(e, t) {
			const i = this._colors, s = i.length;
			if (!this._visible || 0 === s) return;
			const r = Math.round(t.dataLayer.timeToIndexFloat(this._anchor)), n = t.timeScale.visibleRange(), o = Math.max(0, Math.floor(n.from - r)), a = Math.min(s - 1, Math.ceil(n.to - r)), l = t.dpr, h = t.plotWidth * l, c = t.plotHeight * l, d = (e) => Math.min(h, Math.max(0, Math.round(t.timeScale.indexToX(r + e - .5) * l)));
			e.save();
			for (let t = o, s = o; t <= a; t++) {
				const r = i[t];
				if (!(t < a && i[t + 1] === r)) {
					if (r) {
						const i = d(s);
						e.fillStyle = r, e.fillRect(i, 0, d(t + 1) - i, c);
					}
					s = t + 1;
				}
			}
			e.restore();
		}
	};
	function ar(e, t) {
		return e === t ? 0 !== e || 1 / e == 1 / t : e != e && t != t;
	}
	function lr(e, t) {
		const i = t[ns(e).opacity];
		return "number" == typeof i && Number.isFinite(i) ? i : 100;
	}
	function hr(e, t) {
		if ("string" != typeof e || t >= 100) return e;
		const i = Z(e);
		return null === i ? e : `rgba(${i.r},${i.g},${i.b},${i.a * Math.max(0, t) / 100})`;
	}
	var cr = class {
		constructor() {
			Object.defineProperty(this, "_times", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_ordered", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !0
			}), Object.defineProperty(this, "_kept", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: -1
			}), Object.defineProperty(this, "_pass", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_records", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new WeakMap()
			});
		}
		begin(e) {
			const t = this._times, i = t.length, s = e.length;
			let r = this._ordered && s >= i;
			for (let s = 0; s < i && r; s++) r = e[s].time === t[s];
			r || (t.length = 0, this._ordered = !0);
			for (let i = t.length; i < s; i++) {
				const s = e[i].time;
				i > 0 && !(s > t[i - 1]) && (this._ordered = !1), t.push(s);
			}
			this._kept = r && this._ordered ? i : -1, this._pass++;
		}
		clear(e) {
			this._records.delete(e), e.setData([]);
		}
		writeValues(e, t, i, s, r, n) {
			if (void 0 === i) return void this.clear(e);
			const o = s.length, { colorBy: a, colorParts: l } = t, h = void 0 !== a || void 0 !== l, c = h ? lr(t, n) : 100, [d, u] = this._claim(e, 1, 1), _ = d.cols[0], p = d.colors[0], f = [];
			let m = u < 0;
			for (let e = 0; e < o; e++) {
				const t = i[e], s = null == t ? NaN : t;
				let o;
				h && Number.isFinite(s) && (o = hr(l?.({
					value: s,
					index: e,
					values: r,
					settings: n
				})?.body ?? a?.({
					value: s,
					index: e,
					values: r,
					settings: n
				}), c)), !m && (e >= u || !ar(_[e], s) || h && p[e] !== o) && f.push(e) > 8 && (m = !0), _[e] = s, h && (p[e] = o);
			}
			this._commit(e, d, m, f, o, (e) => {
				const t = {
					time: s[e].time,
					value: _[e]
				};
				return void 0 !== p[e] && (t.color = p[e]), t;
			});
		}
		writeCandles(e, t, i, s, r, n, o) {
			const a = s.length, l = [
				i.open,
				i.high,
				i.low,
				i.close
			].map((e) => {
				const i = r[e];
				if (void 0 === i || i.length !== a) throw new Error(`openalgo-charts: ${o} plot "${t.key}" ohlc column "${e}" must be ${a} values`);
				return i;
			}), { colorBy: h, colorParts: c } = t, d = void 0 !== h || void 0 !== c ? lr(t, n) : 100, [u, _] = this._claim(e, 4, 3), [p, f, m, b] = u.cols, [g, v, y] = u.colors, w = [];
			let x = _ < 0;
			for (let e = 0; e < a; e++) {
				const t = l[3][e], i = null === t ? NaN : t, s = l[0][e] ?? NaN, o = l[1][e] ?? NaN, a = l[2][e] ?? NaN;
				let u, S, P;
				if (Number.isFinite(i)) {
					u = h?.({
						value: i,
						index: e,
						values: r,
						settings: n
					});
					const t = c?.({
						value: i,
						index: e,
						values: r,
						settings: n
					});
					void 0 !== t && (void 0 !== t.body && (u = t.body), S = hr(t.wick, d), P = hr(t.border, d)), u = hr(u, d);
				}
				x || !(e >= _) && ar(p[e], s) && ar(f[e], o) && ar(m[e], a) && ar(b[e], i) && g[e] === u && v[e] === S && y[e] === P || !(w.push(e) > 8) || (x = !0), p[e] = s, f[e] = o, m[e] = a, b[e] = i, g[e] = u, v[e] = S, y[e] = P;
			}
			this._commit(e, u, x, w, a, (e) => {
				const t = {
					time: s[e].time,
					open: p[e],
					high: f[e],
					low: m[e],
					close: b[e]
				};
				return void 0 !== g[e] && (t.color = g[e]), void 0 !== v[e] && (t.wickColor = v[e]), void 0 !== y[e] && (t.borderColor = y[e]), t;
			});
		}
		_claim(e, t, i) {
			let s = this._records.get(e);
			const r = void 0 !== s && s.pass === this._pass - 1 ? this._kept : -1;
			if (void 0 === s) s = {
				pass: -1,
				cols: Array.from({ length: t }, () => []),
				colors: Array.from({ length: i }, () => [])
			}, this._records.set(e, s);
			else if (r < 0) for (const e of [...s.cols, ...s.colors]) e.length = 0;
			return [s, r];
		}
		_commit(e, t, i, s, r, n) {
			if (i) {
				const t = new Array(r);
				for (let e = 0; e < r; e++) t[e] = n(e);
				e.setData(t);
			} else if (0 === r) e.setData([]);
			else {
				for (const t of s) e.update(n(t));
				s[s.length - 1] !== r - 1 && e.update(n(r - 1));
			}
			t.pass = this._pass;
		}
	};
	function dr(e) {
		if ("chart" !== e && "underlying" !== e) throw new TypeError(`openalgo-charts: a study bar source is 'chart' or 'underlying', not ${String(e)}`);
		return e;
	}
	function ur(e, t, i) {
		let s = 0, r = e;
		for (; s < r;) {
			const e = s + r >> 1;
			t(e) < i ? s = e + 1 : r = e;
		}
		return s;
	}
	var pr = /^(\d*)\s*([smhdw])$/i;
	var fr = {
		s: 1,
		m: 60,
		h: 3600,
		d: 86400,
		w: 604800
	};
	var mr = /* @__PURE__ */ new Map();
	function wr(e) {
		const t = e.trim(), i = mr.get(t.toLowerCase());
		if (void 0 !== i) return i;
		const s = function(e) {
			if (/^\d*\s*M$/.test(e)) return null;
			const t = pr.exec(e);
			return null === t ? null : {
				mode: "interval",
				seconds: ("" === t[1] ? 1 : Number(t[1])) * fr[t[2].toLowerCase()]
			};
		}(t);
		return null === s ? null : {
			code: t,
			bucketing: s
		};
	}
	var Or = {
		month: 1,
		quarter: 3,
		year: 12
	};
	function kr(e) {
		return Or[e.unit] * Math.max(1, Math.floor(e.count ?? 1));
	}
	function Ir(e, t) {
		return e.timezone ?? t ?? "Asia/Kolkata";
	}
	function Mr(e, t, i) {
		const s = ft(t, i), r = kr(e);
		return Math.floor((12 * s.year + (s.month - 1)) / r) * r;
	}
	function Tr(e, t) {
		return kt(Math.floor(e / 12), e % 12 + 1, 1, 0, 0, 0, t);
	}
	function Cr(e, t, i) {
		if ("interval" === e.mode) {
			const i = e.anchorSec ?? 0;
			return i + Math.floor((t - i) / e.seconds) * e.seconds;
		}
		if ("calendar" !== e.mode) return t;
		const s = Ir(e, i);
		return Tr(Mr(e, t, s), s);
	}
	function jr(e, t, i) {
		if ("interval" === e.mode) return Cr(e, t) + e.seconds;
		if ("calendar" !== e.mode) return null;
		const s = Ir(e, i);
		return Tr(Mr(e, t, s) + kr(e), s);
	}
	function Er(e, t, i) {
		if (!ts(t)) throw new TypeError("Invalid indicator plot price scale map");
		const s = new Set(e.plots.map((e) => e.key));
		return Reflect.ownKeys(t).map((e) => {
			const r = Object.getOwnPropertyDescriptor(t, e);
			if (!("string" == typeof e && s.has(e) && r.enumerable && "value" in r && (L(r.value) || i && null === r.value))) throw new TypeError("Invalid indicator plot price scale assignment");
			return [e, r.value];
		});
	}
	function Br(e, t) {
		return void 0 === t ? {} : Object.fromEntries(Er(e, t, !1));
	}
	function $r(e, t, i) {
		return (Object.prototype.hasOwnProperty.call(i, e.key) ? i[e.key] : void 0) ?? (!0 === e.overlay ? null : t) ?? e.priceScaleId ?? "right";
	}
	function Dr(e, t, i) {
		const s = e.plots.find((e) => !0 !== e.overlay);
		return s ? $r(s, t, i) : t ?? "right";
	}
	function Wr(e, t, i, s, r, n = 0) {
		const o = e.plots.find((e) => e.key === t.between[0]), a = e.plots.find((e) => e.key === t.between[1]), l = !0 === t.overlay ? n : r;
		if (o && (!0 === o.overlay ? n : r) !== l || a && (!0 === a.overlay ? n : r) !== l) return null;
		const h = !0 === t.overlay ? "right" : Dr(e, i, s), c = o ? $r(o, i, s) : h;
		return c === (a ? $r(a, i, s) : h) ? c : null;
	}
	function qr(e, t, i, s, r = 0) {
		if (void 0 !== t && !L(t)) throw new TypeError("Invalid indicator price scale");
		const n = Br(e, i);
		if ((void 0 !== t || 0 !== Object.keys(n).length) && (e.fills ?? []).some((i) => null === Wr(e, i, t ?? null, n, s, r))) throw new RangeError("Indicator fill endpoints must share their pane and price scale");
	}
	function Vr(e) {
		const t = {};
		for (const i of os(e)) t[i.key] = i.default;
		return t;
	}
	function Hr(e, t) {
		if (void 0 !== t && t > 0) return e.toFixed(f(t));
		const i = Math.abs(e);
		return i >= 1e9 ? `${(e / 1e9).toFixed(2)}B` : i >= 1e6 ? `${(e / 1e6).toFixed(2)}M` : i >= 1e3 ? e.toFixed(0) : i >= 1 ? e.toFixed(2) : e.toPrecision(3);
	}
	var Gr = 1;
	var Ur = 1;
	var Kr = !1;
	var Yr = class extends es {};
	var Xr = class {
		constructor(e, t, i = {}, s, r, n, o, a, l, h, c = !1) {
			Object.defineProperty(this, "id", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "indicatorId", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "name", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "paneIndex", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_d", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_ownPane", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_settings", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_scaleOverride", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_plotScaleOverrides", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_policy", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_zoned", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_series", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_plotTypes", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_fills", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_levels", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_levelSig", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: ""
			}), Object.defineProperty(this, "_values", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: {}
			}), Object.defineProperty(this, "_writes", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: new cr()
			}), Object.defineProperty(this, "_barCount", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_firstTime", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_lastTime", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_removed", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_store", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: {}
			}), Object.defineProperty(this, "_attachedPrimitives", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Set()
			}), Object.defineProperty(this, "_detach", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_lifetime", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: new AbortController()
			}), Object.defineProperty(this, "_dataStatus", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_dataRetry", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_dataListeners", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Set()
			}), Object.defineProperty(this, "_legend", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_markers", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_markerSeries", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_markerLayers", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_table", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_tables", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_draws", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_drawLayers", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_background", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_bgLayers", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_alertTime", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_alertRead", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: -1 / 0
			}), Object.defineProperty(this, "_alertPolicy", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_calculationEpoch", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_live", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_sourceId", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_sourceRevision", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_sourceHistoryRevision", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_sourceLastTime", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_visible", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !0
			}), Object.defineProperty(this, "_constructed", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_calcFailed", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_lifecycleStatus", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_generation", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: Ur++
			}), Object.defineProperty(this, "_outputRevision", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_outputHistoryRevision", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_outputSource", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_studySnapshots", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_dependencyUnavailable", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_alertNeedsSeed", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_outputPending", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_publishedBarColors", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_barSource", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_restored", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_sampled", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), this._restored = c, this._host = e, this._d = t, this._barSource = void 0 === h ? "chart" : dr(h), this._policy = void 0 === l ? Object.freeze({}) : js(l), this._scaleOverride = o ?? null, this._plotScaleOverrides = Br(t, a), this.indicatorId = t.id, this.name = t.name, this._alertPolicy = new xs(t.alerts ?? []);
			let d = r;
			if (void 0 === d) do
				d = `${t.id}-${Gr++}`;
			while (n?.has(d));
			this.id = d, this._settings = this._validatedSettings({
				...ps(t),
				...Vr(t),
				...ks(i)
			}), void 0 !== s ? (this.paneIndex = s, this._ownPane = !1) : "onchart" === t.placement ? (this.paneIndex = this._pricePane(), this._ownPane = !1) : (this.paneIndex = e.nextPaneIndex(), this._ownPane = !0), qr(t, o, void 0 === a ? void 0 : this._plotScaleOverrides, this.paneIndex, this._pricePane());
			for (const i of t.plots) {
				const t = this._plotType(i);
				this._plotTypes.set(i.key, t), this._series.set(i.key, e.addIndicatorSeries(t, this._plotPane(i), this._plotStyle(i), this._plotScale(i), i.priceFormat));
			}
			for (const i of t.fills ?? []) {
				const t = new ir({
					colorUp: this._fillColor(i, !0),
					colorDown: this._fillColor(i, !1),
					opacity: i.opacity ?? .12
				});
				this._fills.push(t), e.addIndicatorFill(t, !0 === i.overlay ? this._pricePane() : this.paneIndex);
				const s = this._fillScale(i, this._scaleOverride);
				null !== s && e.bindIndicatorPrimitiveScale?.(t, s);
			}
			this._legend = e.addIndicatorLegend({
				id: `indicator:${this.id}`,
				title: t.name,
				params: this._paramSummary(),
				color: this._legendColor(),
				row: e.legendRowsOn(this.paneIndex),
				paneIndex: this.paneIndex,
				hasSource: !0 === t.hasSource
			}), this._applyRange();
			try {
				this.recompute();
			} catch (e) {
				throw this.remove({ force: !0 }), e;
			}
			this._constructed = !0, this._attach();
		}
		_plotPane(e) {
			return !0 === e.overlay ? this._pricePane() : this.paneIndex;
		}
		_pricePane() {
			return this._host.primaryPaneIndex?.() ?? 0;
		}
		_plotScale(e, t = this._scaleOverride, i = this._plotScaleOverrides) {
			return $r(e, t, i);
		}
		_localScale(e = this._scaleOverride, t = this._plotScaleOverrides) {
			return Dr(this._d, e, t);
		}
		_fillScale(e, t, i = this.paneIndex, s = this._plotScaleOverrides) {
			return Wr(this._d, e, t, s, i, this._pricePane());
		}
		_targetKey({ plot: e, overlay: t }) {
			if (void 0 === e) return !0 === t ? null : void 0;
			if (!0 === t || !this._d.plots.some((t) => t.key === e)) throw new Error("Indicator output target must name one declared plot or the price pane");
			return e;
		}
		_targets() {
			return [null, ...this._d.plots.map((e) => e.key)];
		}
		_route(e, t) {
			const i = [], s = new Map(this._targets().map((e) => [e, []]));
			for (const r of e) {
				const e = this._targetKey(r);
				(void 0 === e || t?.(e) ? i : s.get(e)).push(r);
			}
			for (const [e, t] of s) 0 === t.length && s.delete(e);
			return [s.size > 0 ? i : e, s];
		}
		_overlayTarget(e) {
			return null === e || this._d.plots.some((t) => t.key === e && !0 === t.overlay);
		}
		_drawTarget(e, t = this._scaleOverride, i = this._plotScaleOverrides) {
			const s = this._d.plots.find((t) => t.key === e);
			return s ? [this._plotPane(s), this._plotScale(s, t, i)] : [this._pricePane(), null];
		}
		priceScaleId() {
			return this._scaleOverride;
		}
		plotPriceScaleId(e) {
			const t = this._d.plots.find((t) => t.key === e);
			return t ? this._plotScale(t) : null;
		}
		plotPriceScaleIds() {
			return { ...this._plotScaleOverrides };
		}
		canRelocate(e) {
			return (this._d.fills ?? []).every((t) => null !== this._fillScale(t, this._scaleOverride, e));
		}
		adoptPriceScale(e) {
			this._scaleOverride = e, this._plotScaleOverrides = this._overlayScaleOverrides();
		}
		_overlayScaleOverrides() {
			return Object.fromEntries(this._d.plots.filter((e) => !0 === e.overlay && Object.prototype.hasOwnProperty.call(this._plotScaleOverrides, e.key)).map((e) => [e.key, this._plotScaleOverrides[e.key]]));
		}
		policy() {
			return this._policy;
		}
		barSource() {
			return this._barSource;
		}
		setBarSource(e, t) {
			const i = dr(e);
			return !(this._removed || i === this._barSource || !this._allows("configurable", t)) && (this._barSource = i, this._barCount = 0, this._requestRecompute(!0), this._host.emit?.("objects:change", {}), !0);
		}
		setPolicy(e) {
			const t = null === e ? Object.freeze({}) : js(e);
			this._removed || (this._policy = t, this._host.policyChanged?.());
		}
		_allows(e, t) {
			return !0 === t?.force || !1 !== this._policy[e];
		}
		setPriceScale(e, t) {
			if (this._removed || !this._allows("configurable", t) || null !== e && !L(e)) return !1;
			const i = this._overlayScaleOverrides();
			return (e !== this._scaleOverride || Object.keys(i).length !== Object.keys(this._plotScaleOverrides).length) && this._assignPriceScales(e, i, !1);
		}
		setPlotPriceScales(e, t) {
			if (this._removed || !this._allows("configurable", t)) return !1;
			let i;
			try {
				i = Er(this._d, e, !0);
			} catch {
				return !1;
			}
			const s = new Map(Object.entries(this._plotScaleOverrides));
			let r = !1;
			for (const [e, t] of i) null === t ? r = s.delete(e) || r : s.get(e) !== t && (s.set(e, t), r = !0);
			return r && this._assignPriceScales(this._scaleOverride, Object.fromEntries(s), !0);
		}
		_assignPriceScales(e, t, i) {
			const s = this._d.plots.filter((e) => i || !0 !== e.overlay), r = /* @__PURE__ */ new Map();
			for (const i of s) {
				const s = this._plotScale(i, e, t);
				if (s === this._plotScale(i)) continue;
				const n = this._plotPane(i), o = r.get(n) ?? /* @__PURE__ */ new Set();
				o.add(s), r.set(n, o);
			}
			const n = s.flatMap((i) => {
				const s = this._plotScale(i, e, t);
				if (!r.get(this._plotPane(i))?.has(s)) return [];
				const n = this._series.get(i.key);
				return n ? [{
					api: n,
					scaleId: s
				}] : [];
			}), o = [];
			for (let s = 0; s < this._fills.length; s++) {
				const r = this._fillScale(this._d.fills[s], e, this.paneIndex, t);
				if (null === r) return !1;
				!i && !0 === this._d.fills[s].overlay || r === this._fillScale(this._d.fills[s], this._scaleOverride) || o.push({
					primitive: this._fills[s],
					scaleId: r
				});
			}
			const a = this._localScale(e, t);
			if (a !== this._localScale()) for (const e of [
				...this._levels,
				this._draws,
				...this._attachedPrimitives
			]) null !== e && o.push({
				primitive: e,
				scaleId: a
			});
			for (const [i, s] of [...this._drawLayers, ...this._bgLayers]) {
				const r = this._drawTarget(i, e, t)[1];
				null !== r && r !== this._drawTarget(i)[1] && o.push({
					primitive: s,
					scaleId: r
				});
			}
			const l = this._settings, h = this._plotScaleOverrides, c = this._scaleOverride, d = this.paneIndex, u = this._host.setIndicatorRange || this._ownPane ? this._d.range?.(this._descriptorSettings()) ?? null : null;
			if (this._removed || l !== this._settings || h !== this._plotScaleOverrides || c !== this._scaleOverride || d !== this.paneIndex) return !1;
			const _ = this._host.assignIndicatorScale?.(this.id, n, o, () => {
				this._scaleOverride = e, this._plotScaleOverrides = t, this._applyRange(u);
			}) ?? !1;
			return _ && this.updateLegendValues(this._host.legendIndex?.()), _;
		}
		_paramSummary() {
			const e = [];
			for (const t of this._d.inputs) {
				if ("color" === t.type || "boolean" === t.type) continue;
				const i = this._settings[t.key];
				if (null != i && "" !== i) if ("source" === t.type && t.allowStudyOutputs && "object" == typeof i) {
					const t = i;
					e.push(`${t.instanceId}/${t.plotKey}`);
				} else e.push(String(i));
			}
			return e.join(" ");
		}
		_legendColor() {
			for (const e of this._d.plots) {
				const t = e.colorKey;
				if (void 0 !== t && "string" == typeof this._settings[t]) return this._settings[t];
				if ("string" == typeof e.style?.color) return e.style.color;
			}
		}
		visible() {
			return this._visible;
		}
		setVisible(e) {
			if (this._removed || e === this._visible) return;
			this._visible = e;
			for (const t of this._d.plots) this._series.get(t.key)?.applyOptions({ visible: e && !1 !== t.style?.visible });
			for (const t of this._fills) t.setVisible(e);
			const t = this._host.sourceBars();
			this._applyLevels(t, this._descriptorSettings()), this._syncMarkers(t);
			try {
				this._syncTable(t);
			} catch (e) {
				this._calcFailed = !0, this._publishStatus({
					state: "error",
					error: e
				});
			}
			this._syncBarColors(t), this._draws?.setVisible(e);
			for (const t of [...this._drawLayers.values(), ...this._bgLayers.values()]) t.setVisible(e);
			this._background?.setVisible(e), this._legend?.setOptions({ hidden: !e }), this._host.emit?.("objects:change", {});
		}
		shiftPane(e) {
			this.paneIndex += e;
		}
		renderResources() {
			const e = this._d.plots.flatMap((e) => {
				const t = this._series.get(e.key);
				return t ? [{
					api: t,
					overlay: !0 === e.overlay
				}] : [];
			}), t = this._fills.map((e, t) => ({
				primitive: e,
				overlay: !0 === this._d.fills?.[t].overlay
			}));
			for (const { table: e, overlay: i } of this._tables.values()) t.push({
				primitive: e,
				overlay: i
			});
			Kr && (e.length = 0, t.length = 0);
			const i = (...i) => {
				for (const s of i) null === s || Kr || t.push({
					primitive: s,
					overlay: s === this._markers && (this._markerSeries === this._host.primarySeries?.() || e.some((e) => e.api === this._markerSeries && e.overlay))
				});
			}, s = (e) => {
				for (const i of this._targets()) {
					const s = e(i);
					s && t.push({
						primitive: s,
						overlay: this._overlayTarget(i)
					});
				}
			};
			return i(this._legend, ...this._levels, this._markers), s((e) => this._markerLayers.get(e)?.[0]), i(this._table, this._draws), s((e) => this._drawLayers.get(e)), i(this._background), s((e) => this._bgLayers.get(e)), i(...this._attachedPrimitives), {
				series: e,
				primitives: t
			};
		}
		relocate(e) {
			this._ownPane && !this._host.setIndicatorRange && this._host.setPaneRange(this.paneIndex, null), this.paneIndex = e, this._applyRange(), this._syncMarkers(this._host.sourceBars());
		}
		refreshBarColors() {
			Kr || (this._calcFailed ? this.republishBarColors() : this._syncBarColors(this._host.sourceBars()));
		}
		republishBarColors() {
			this._d.barColors && this._host.setBarColors?.(this._publishedBarColors, this.id);
		}
		legend() {
			return this._legend;
		}
		updateLegendValues(e) {
			if (null === this._legend) return;
			const t = this._barCount, i = void 0 === e || e < 0 || e >= t ? t - 1 : e;
			if (i < 0) return void this._legend.setValues([]);
			const s = [];
			for (const e of this._d.plots) {
				const t = this._values[e.ohlc?.close ?? e.key]?.[i - (e.offset ?? 0)];
				if (null == t || !Number.isFinite(t)) continue;
				const r = this._plotPane(e), n = this._plotColor(e);
				if (void 0 !== n && se(n)) continue;
				const o = this._host.formatPrice?.(r, t, this._series.get(e.key)) ?? Hr(t, this._host.tickSize?.(r));
				s.push({
					text: o,
					color: n
				});
			}
			this._legend.setValues(s);
		}
		_fillColor(e, t) {
			const i = t ? e.colorUpKey : e.colorDownKey, s = void 0 !== i ? this._settings[i] : void 0;
			if ("string" == typeof s) return s;
			return (t ? e.colorUp : e.colorDown) ?? (t ? "#26a69a" : "#ef5350");
		}
		_syncFills(e) {
			const t = this._d.fills ?? [], i = this._descriptorSettings();
			for (let s = 0; s < t.length; s++) {
				const r = this._fills[s];
				if (void 0 === r) continue;
				const n = t[s], o = this._values[n.between[0]], a = this._values[n.between[1]];
				if (r.setOptions({
					colorUp: this._fillColor(n, !0),
					colorDown: this._fillColor(n, !1),
					opacity: n.opacity ?? .12,
					gradient: "function" == typeof n.gradient ? n.gradient({
						bars: e,
						values: this._values,
						settings: i
					}) : n.gradient
				}), void 0 === o || void 0 === a) {
					r.setPoints([]);
					continue;
				}
				const l = this._d.plots.find((e) => e.key === n.between[0])?.offset ?? 0, h = [];
				for (let e = 0; e < this._barCount; e++) {
					const t = o[e] ?? null, s = a[e] ?? null, r = {
						index: e,
						a: t,
						b: s,
						values: this._values,
						settings: i
					}, c = n.colorBy?.(r), d = n.gradientBy?.(r);
					h.push({
						index: e + l,
						a: t,
						b: s,
						color: c,
						gradient: d
					});
				}
				r.setPoints(h);
			}
		}
		_syncMarkers(e) {
			if (this._dependencyUnavailable) return;
			if (void 0 === this._d.markers) return;
			const t = this._sampled, i = this._visible ? this._d.markers({
				bars: e,
				values: this._values,
				settings: this._descriptorSettings()
			}).flatMap((i) => {
				const s = null === t ? i.time : function(e, t, i, s) {
					if (t[ur(t.length, (e) => t[e].time, e)]?.time === e) return e;
					const n = ur(i.length, (e) => i[e].time, e);
					return t[ur(s.length, (e) => s[e], n)]?.time ?? null;
				}(i.time, e, t.bars, t.sourceIndex);
				return null === s ? [] : [s === i.time ? i : {
					...i,
					time: s
				}];
			}) : [], s = this._host.primarySeries?.() ?? void 0, r = this.paneIndex === this._pricePane(), n = ("price" === this._d.markerAnchor && r ? s : void 0) ?? this._series.get(this._d.plots[0]?.key ?? ""), o = (e) => null === e ? s : this._series.get(e), [a, l] = this._route(i, (e) => o(e) === n && !(!r && this._overlayTarget(e)));
			l.size > 0 && new er(0).setMarkers(i);
			let h = !1;
			null !== this._markers && n !== this._markerSeries && (this._host.removeIndicatorMarkers(this._markers), this._markers = null), null === this._markers && a.length > 0 && void 0 !== n && (this._markerSeries = n, this._markers = n.createMarkers(() => {
				const e = this._host.primarySeries?.();
				return this.paneIndex === this._pricePane() && null != e && n.priceScale() === e.priceScale() ? this._host.sourceBars() : [];
			})), this._markers?.setMarkers(a);
			for (const [e, [t, i]] of this._markerLayers) i !== o(e) || this._visible && !l.has(e) ? (this._host.removeIndicatorMarkers(t), this._markerLayers.delete(e)) : this._visible || t.setMarkers([]);
			for (const [e, t] of l) {
				let i = this._markerLayers.get(e);
				const s = o(e);
				if (void 0 === i && void 0 !== s) {
					const t = this._d.plots.find((t) => t.key === e);
					h = !0, this._markerLayers.set(e, i = [s.createMarkers(t && (() => {
						const e = this._host.primarySeries?.();
						return this._plotPane(t) === this._pricePane() && null != e && s.priceScale() === e.priceScale() ? this._host.sourceBars() : [];
					})), s]);
				}
				i?.[0].setMarkers(t);
			}
			this._restack(h);
		}
		_syncTable(e) {
			if (this._dependencyUnavailable) return;
			if (void 0 !== this._d.tables) return void this._syncTables(e);
			if (void 0 === this._d.table) return;
			const t = this._visible ? this._d.table({
				bars: e,
				values: this._values,
				settings: this._descriptorSettings()
			}) : null, i = t?.rows ?? [];
			if (null === this._table) {
				if (0 === i.length) return;
				this._table = this._host.addIndicatorTable(this.paneIndex);
			}
			void 0 !== t?.options && this._table.setOptions(t.options), this._table.setRows(i);
		}
		_syncTables(e) {
			if (!this._visible) {
				for (const { table: e } of this._tables.values()) e.setRows([]);
				return;
			}
			const t = this._d.tables({
				bars: e,
				values: this._values,
				settings: this._descriptorSettings()
			}), i = /* @__PURE__ */ new Set();
			for (const e of t) {
				if ("string" != typeof e.id || "" === e.id.trim() || i.has(e.id)) throw new Error("Indicator table IDs must be nonempty and unique");
				i.add(e.id);
			}
			for (const [e, { table: t }] of this._tables) i.has(e) || (this._host.removeIndicatorTable(t), this._tables.delete(e));
			for (const e of t) {
				const t = !0 === e.overlay;
				let i = this._tables.get(e.id);
				void 0 !== i && i.overlay !== t && (this._host.removeIndicatorTable(i.table), this._tables.delete(e.id), i = void 0), void 0 === i && (i = {
					table: this._host.addIndicatorTable(t ? this._pricePane() : this.paneIndex),
					overlay: t
				}, this._tables.set(e.id, i)), void 0 !== e.options && i.table.setOptions(e.options), i.table.setRows(e.rows);
			}
		}
		_syncDraws(e) {
			if (void 0 === this._d.draws) return;
			const t = this._d.draws({
				bars: e,
				values: this._values,
				settings: this._descriptorSettings()
			}), [i, s] = this._route(t);
			s.size > 0 && new nr().setItems(t), null === this._draws && i.length > 0 && void 0 !== this._host.addIndicatorPrimitive && (this._draws = new nr(), this._draws.setVisible(this._visible), this._host.addIndicatorPrimitive(this._draws, this.paneIndex), this._host.bindIndicatorPrimitiveScale?.(this._draws, this._localScale())), this._draws?.setItems(i), this._syncRouted(this._drawLayers, s, (e, t) => new nr(null === t ? (e) => e.readoutPriceScale : void 0), (e, t) => e.setItems(t));
		}
		_syncRouted(e, t, i, s) {
			let r = !1;
			for (const [i, s] of e) t.has(i) || (this._host.removeIndicatorPrimitive?.(s), e.delete(i));
			for (const [n, o] of t) {
				let t = e.get(n);
				if (void 0 === t) {
					const [s, a] = this._drawTarget(n), l = this._host.addIndicatorPrimitive && i(o, a);
					if (!l) continue;
					r = !0, e.set(n, t = l), t.setVisible(this._visible), this._host.addIndicatorPrimitive(t, s), null !== a && this._host.bindIndicatorPrimitiveScale?.(t, a);
				}
				s(t, o);
			}
			this._restack(r);
		}
		_restack(e) {
			if (e && this._constructed) {
				Kr = !0;
				try {
					this._host.resourcesChanged?.();
				} finally {
					Kr = !1;
				}
			}
		}
		_syncBackground(e) {
			if (void 0 === this._d.background) return;
			const t = this._d.background({
				bars: e,
				values: this._values,
				settings: this._descriptorSettings()
			}), i = t.some((e) => "object" == typeof e && null !== e);
			if (i) {
				for (const e of t) if (!Array.isArray(e?.colors)) throw new Error("Indicator background must return colours or a list of columns");
			}
			const [s, r] = i ? this._route(t) : [[{ colors: t }], /* @__PURE__ */ new Map()];
			for (const e of [s, ...r.values()]) if (e.length > 1) throw new Error("Indicator background allows one column per target");
			const n = s[0]?.colors ?? [];
			null === this._background && n.length > 0 && void 0 !== this._host.addIndicatorPrimitive && (this._background = new or(), this._background.setVisible(this._visible), this._host.addIndicatorPrimitive(this._background, this.paneIndex)), this._background?.setColors(n, e), this._syncRouted(this._bgLayers, r, ([e]) => e.colors.length > 0 ? new or() : null, (t, [i]) => t.setColors(i.colors, e));
		}
		_syncBarColors(e) {
			if (void 0 === this._d.barColors) return;
			const t = this._visible && !this._dependencyUnavailable ? this._d.barColors({
				bars: e,
				values: this._values,
				settings: this._descriptorSettings()
			}) : null;
			this._publishedBarColors = t, this._host.setBarColors?.(t, this.id);
		}
		_syncAlerts(e, t, i, s, r, n) {
			const o = this._d.alerts, a = e.length;
			if (void 0 === o || !n()) return;
			const l = this._alertTime, h = ws(e, this._sampled);
			a > 0 && (this._alertTime = e[a - 1].time);
			let c = a;
			if (i && !r) for (; c > 0 && e[c - 1].time > l;) c--;
			else this._alertRead = a > 0 ? h(a - 1) : -1 / 0;
			let d, u = !1;
			for (let i = c; i < a; i++) {
				if (h(i) <= this._alertRead) continue;
				this._alertRead = h(i);
				const s = ys(e, this._values, t, i);
				for (const t of o) if (void 0 === t.frequency) {
					if (!n()) return;
					try {
						const r = t.when(s);
						if (!n()) return;
						if (!r) continue;
						const o = "function" == typeof t.message ? t.message(s) : t.message ?? t.title;
						if (!n()) return;
						this._host.emit?.("indicator:alert", {
							indicatorId: this.indicatorId,
							instanceId: this.id,
							alertId: t.id,
							title: t.title,
							message: o,
							time: e[i].time,
							index: i
						});
					} catch (e) {
						if (!n()) return;
						u || (u = !0, d = e);
					}
				}
			}
			if (n()) {
				try {
					this._alertPolicy.evaluate({
						bars: e,
						values: this._values,
						settings: t,
						calculation: s,
						tailOnly: i,
						refresh: r,
						current: n,
						from: c,
						sampled: this._sampled
					}, (e) => {
						this._host.emit?.("indicator:alert", {
							...e,
							indicatorId: this.indicatorId,
							instanceId: this.id
						});
					});
				} catch (e) {
					u || (u = !0, d = e);
				}
				if (u && n()) throw d;
			}
		}
		_calcContext(e, t, i) {
			const s = e.length, r = () => this._host.now?.() ?? Date.now() / 1e3, n = this._host.interval?.(), o = this._host.timezone?.() ?? "Asia/Kolkata", a = s > 1 ? e[s - 1].time - e[s - 2].time : 0;
			let l = 0 === s, h = 0 === s ? "empty" : "unknown";
			if (s > 0) {
				const t = e[s - 1].time;
				if (void 0 === n) l = a <= 0 || r() >= t + a, h = "clock";
				else {
					const e = wr(n)?.bucketing, i = "interval" === e?.mode ? e.seconds > 0 ? t + e.seconds : null : void 0 === e ? null : jr(e, t, o);
					l = null !== i && r() >= i, null !== i && (h = "clock");
				}
			}
			s > 0 && void 0 !== i?.confirmation && (l = "confirmed" === i.confirmation, h = i.confirmationSource ?? "provider");
			const c = null === this._sourceRevision || i?.sourceId !== this._sourceId, d = void 0 !== i && i.revision !== this._sourceRevision, u = void 0 === i ? this._live : !c && d && "live" === i.provenance;
			return {
				...void 0 === i ? {} : { execution: {
					sourceId: i.sourceId,
					provenance: "replay" === i.provenance ? "replay" : u ? "live" : "history",
					change: c ? "initial" : d ? i.change : "refresh",
					revision: i.revision,
					historyRevision: i.historyRevision,
					confirmationSource: h
				} },
				barState: {
					isNew: void 0 === i ? t : u && s > 0 && (void 0 === this._sourceLastTime || e[s - 1].time > this._sourceLastTime),
					isConfirmed: l,
					isRealtime: u,
					lastIndex: s - 1
				},
				symbol: this._host.symbol?.(),
				interval: n,
				timezone: o,
				now: r,
				tickSize: this._host.tickSize?.(this._pricePane()) || void 0
			};
		}
		_plotType(e) {
			const t = this._settings[ns(e).type];
			return "string" == typeof t && "" !== t ? t : e.type;
		}
		_plotColor(e) {
			const t = this._settings[ns(e).color];
			return "string" == typeof t ? t : "string" == typeof e.style?.color ? e.style.color : void 0;
		}
		_plotStyle(e) {
			const t = ns(e), i = {
				...e.style ?? {},
				title: e.title,
				visible: this._visible && !1 !== e.style?.visible
			}, s = this._plotColor(e), r = (n = this._settings[t.opacity], o = 100, "number" == typeof n && Number.isFinite(n) ? n : o);
			var n, o;
			void 0 !== s && (i.color = r >= 100 ? s : ie(s, r / 100));
			const a = this._settings[t.width];
			"number" == typeof a && a > 0 && (i.lineWidth = a);
			const l = this._settings[t.lineStyle];
			return "string" == typeof l && (i.lineStyle = l), void 0 !== e.offset && 0 !== e.offset && (i.barOffset = e.offset), i;
		}
		_attach() {
			this._dataRetry = null;
			const e = this._d.attach?.({
				dataContext: () => this._host.dataContext?.(),
				subscribeDataChanges: (e) => this._host.subscribeDataChanges?.(e) ?? (() => {}),
				signal: this._lifetime.signal,
				setDataStatus: (e) => {
					this._lifecycleStatus = Object.freeze({ ...e }), this._publishStatus(this._lifecycleStatus);
				},
				setDataRetry: (e) => {
					this._removed || (this._dataRetry = e);
				},
				requestBars: (e) => {
					const t = this._host.requestBars;
					return void 0 === t ? Promise.reject(/* @__PURE__ */ new Error("openalgo-charts: this chart has no bars provider; call chart.setBarsProvider(...) to serve other instruments")) : bs((i) => t.call(this._host, {
						...e,
						signal: i
					}), [e.signal, this._lifetime.signal]);
				},
				requestSnapshot: (e) => bs((t) => {
					const i = this._host.requestSnapshot;
					if (!i) throw new Error("Requested snapshots are unsupported by this host");
					return i.call(this._host, {
						...e,
						signal: t
					});
				}, [e.signal, this._lifetime.signal]),
				requestState: this._host.requestState ? () => this._host.requestState() : void 0,
				subscribeRequestChanges: this._host.subscribeRequestChanges ? (e) => this._host.subscribeRequestChanges(e) : void 0,
				settings: () => this._descriptorSettings(),
				bars: () => ("underlying" === this._barSource ? this._host.underlyingBars?.()?.bars : void 0) ?? this._host.sourceBars(),
				requestRecompute: () => {
					this._removed || (this._barCount = 0, this._requestRecompute(!0));
				},
				store: this._store,
				symbol: () => this._host.symbol?.(),
				interval: () => this._host.interval?.(),
				timezone: () => this._host.timezone?.() ?? "Asia/Kolkata",
				now: () => this._host.now?.() ?? Date.now() / 1e3,
				paneIndex: () => this.paneIndex,
				addPrimitive: (e) => {
					this._attachedPrimitives.add(e), this._host.addIndicatorPrimitive?.(e, this.paneIndex), this._host.bindIndicatorPrimitiveScale?.(e, this._localScale());
				},
				removePrimitive: (e) => {
					this._attachedPrimitives.delete(e), this._host.removeIndicatorPrimitive?.(e);
				},
				emit: (e, t) => {
					this._host.emit?.(e, t);
				}
			});
			this._detach = "function" == typeof e ? e : null;
		}
		_publishStatus(e) {
			if (this._removed) return;
			const t = this._dataStatus;
			if (t?.state !== e.state || "error" === e.state && ("error" !== t.state || t.error !== e.error)) {
				this._dataStatus = Object.freeze({ ...e }), this._outputRevision++, this._outputHistoryRevision++, this._host.indicatorOutputChanged?.(this.id, !0);
				for (const e of this._dataListeners) e(this._dataStatus);
				this._host.emit?.("indicator:data-status", {
					id: this.id,
					indicatorId: this.indicatorId,
					status: this._dataStatus
				});
			}
		}
		dataStatus() {
			return this._dataStatus;
		}
		subscribeDataStatus(e) {
			return this._removed ? () => {} : (this._dataListeners.add(e), null !== this._dataStatus && e(this._dataStatus), () => {
				this._dataListeners.delete(e);
			});
		}
		retryData() {
			this._removed || this._dataRetry?.();
		}
		dependencyNode() {
			return {
				id: this.id,
				descriptor: this._d,
				settings: this._settings
			};
		}
		invalidateStudyOutput() {
			this._outputPending = !0;
		}
		_validatedSettings(e) {
			const t = ks(e);
			ss(this._d.inputs, t), Ts([{
				id: this.id,
				descriptor: this._d,
				settings: t
			}]), this._host.validateIndicatorSettings?.(this.id, this._d, t);
			for (const e of this._d.inputs) "source" === e.type && "object" == typeof t[e.key] && null !== t[e.key] && Object.freeze(t[e.key]);
			return t;
		}
		studyOutput(e) {
			const t = this._d.plots.find((t) => t.key === e);
			if (t && !t.ohlc) return {
				generation: this._generation,
				revision: this._outputRevision,
				historyRevision: this._outputHistoryRevision,
				source: this._outputSource,
				values: this._values[e] ?? [],
				available: !this._removed && this._outputRevision > 0 && !this._outputPending && !this._calcFailed && !this._dependencyUnavailable && (null === this._lifecycleStatus || "ready" === this._lifecycleStatus.state)
			};
		}
		_studyBindings(e, t) {
			const i = Ts([this.dependencyNode()]).dependencies.get(this.id) ?? [], s = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map();
			let n = this._studySnapshots.size === i.length;
			for (const { inputKey: o, source: a } of i) {
				const i = this._host.studyOutput?.(a);
				if (!i?.available || i.values.length !== e.length || void 0 !== t && (i.source?.sourceId !== t.sourceId || i.source.revision !== t.revision || i.source.historyRevision !== t.historyRevision)) throw new Yr(`Study input ${o} is unavailable: ${a.instanceId}/${a.plotKey}`);
				s.set(o, i), r.set(o, Object.freeze(i.values.slice()));
				const l = this._studySnapshots.get(o);
				(!l || l.generation !== i.generation || l.historyRevision !== i.historyRevision || l.revision > i.revision) && (n = !1);
			}
			return {
				snapshots: s,
				canTail: n,
				current: () => i.every(({ inputKey: e, source: t }) => {
					const i = s.get(e), r = this._host.studyOutput?.(t);
					return !0 === r?.available && i.generation === r.generation && i.revision === r.revision && i.historyRevision === r.historyRevision;
				}),
				resolve: (e) => {
					const t = i.find((t) => t.source.instanceId === e.instanceId && t.source.plotKey === e.plotKey);
					if (!t) throw new es("Study source must be declared by an opted-in input");
					return r.get(t.inputKey);
				}
			};
		}
		_requestRecompute(e) {
			this._host.indicatorRecompute ? this._host.indicatorRecompute(this.id, e, () => this.recompute(e)) : this.recompute(e);
		}
		_clearUnavailableOutput(e) {
			this._dependencyUnavailable = !0, this._alertNeedsSeed = !0, this._studySnapshots.clear();
			const t = /* @__PURE__ */ new Set([...Object.keys(this._values), ...this._d.plots.map((e) => e.key)]);
			this._values = Object.fromEntries([...t].map((t) => [t, new Array(e.length).fill(null)])), this._barCount = 0, this._outputHistoryRevision++;
			for (const e of this._series.values()) this._writes.clear(e);
			for (const e of this._fills) e.setPoints([]);
			this._markers?.setMarkers([]);
			for (const [e] of this._markerLayers.values()) e.setMarkers([]);
			this._table?.setRows([]);
			for (const { table: e } of this._tables.values()) e.setRows([]);
			this._draws?.setItems([]);
			for (const e of this._drawLayers.values()) e.setItems([]);
			for (const t of [this._background, ...this._bgLayers.values()]) t?.setColors([], e);
			for (const e of this._levels) this._host.removeIndicatorLevel(e);
			this._levels = [], this._publishedBarColors = null, this._host.setBarColors?.(null, this.id), this.updateLegendValues();
		}
		settings() {
			return ks(this._settings);
		}
		_descriptorSettings() {
			const e = this._host.timezone?.() ?? "Asia/Kolkata";
			if (e === "Asia/Kolkata") return this._settings;
			const t = this._zoned;
			if (null !== t && t.zone === e && t.base === this._settings) return t.merged;
			const i = {
				...this._settings,
				timezone: e
			};
			return this._zoned = {
				zone: e,
				base: this._settings,
				merged: i
			}, i;
		}
		series(e) {
			return this._series.get(e);
		}
		values() {
			return this._host.flushIndicators?.(), this._values;
		}
		setSettings(e, t) {
			if (this._removed || !this._allows("configurable", t)) return !1;
			this._settings = this._validatedSettings({
				...this._settings,
				...ks(e)
			}), this._outputPending = !0, this._host.indicatorOutputChanged?.(this.id, !0);
			for (const e of this._d.plots) {
				const t = this._plotType(e);
				if (t !== this._plotTypes.get(e.key)) {
					const i = this._series.get(e.key);
					if (i && this._host.setIndicatorSeriesType?.(i, t)) {
						i.applyOptions(this._plotStyle(e)), this._plotTypes.set(e.key, t);
						continue;
					}
					this._series.get(e.key)?.remove(), this._series.set(e.key, this._host.addIndicatorSeries(t, this._plotPane(e), this._plotStyle(e), this._plotScale(e), e.priceFormat)), this._plotTypes.set(e.key, t);
					continue;
				}
				this._series.get(e.key)?.applyOptions(this._plotStyle(e));
			}
			return this._legend?.setOptions({
				params: this._paramSummary(),
				color: this._legendColor()
			}), this._applyRange(), this._values = {}, this._barCount = 0, this._requestRecompute(!0), this._detach?.(), this._attach(), this._host.resourcesChanged?.(), this._host.emit?.("objects:change", {}), !0;
		}
		recompute(e = !1) {
			if (this._removed) return;
			const t = ++this._calculationEpoch, i = this._settings, s = this._host.sourceState?.(), r = this._host.sourceBars(), n = "underlying" === this._barSource ? this._host.underlyingBars?.() ?? null : null, o = n?.bars ?? r, a = n?.sourceIndex ?? null;
			let l;
			const h = () => {
				if (this._removed || t !== this._calculationEpoch || i !== this._settings) return !1;
				if (l && !l.current()) return !1;
				const e = this._host.sourceState?.();
				return void 0 === s ? void 0 === e : void 0 !== e && s.sourceId === e.sourceId && s.revision === e.revision && s.historyRevision === e.historyRevision && s.provenance === e.provenance;
			};
			try {
				l = this._studyBindings(o, s), this._recompute(e, o, null === a ? o : r, a, s, l, h);
			} catch (e) {
				if (!h()) return;
				if (!(this._constructed || e instanceof Yr || this._restored && e instanceof es)) throw e;
				e instanceof Yr && this._clearUnavailableOutput(null === a ? o : r), this._calcFailed = !0, this._publishStatus({
					state: "error",
					error: e
				}), this._host.indicatorOutputChanged?.(this.id, !0);
				return;
			}
			h() && (this._calcFailed && (this._calcFailed = !1, this._publishStatus(this._lifecycleStatus ?? { state: "ready" })), h() && this._host.indicatorOutputChanged?.(this.id, e));
		}
		_recompute(e, t, i, s, r, n, o) {
			const a = i.length, l = this._descriptorSettings();
			let h = null;
			const c = this._barCount > 0 && a >= this._barCount ? i[this._barCount - 1].time : NaN, d = (c === this._lastTime || void 0 !== r && c > this._lastTime) && (1 === this._barCount || i[0].time === this._firstTime), u = d && a > this._barCount, _ = d && (void 0 === r || r.sourceId === this._sourceId && r.revision !== this._sourceRevision && r.historyRevision === this._sourceHistoryRevision && "live" === r.provenance);
			void 0 === r && _ && (this._live = !0), _ && c > this._lastTime && this._redate(c, t === i);
			const p = this._calcContext(t, u, r);
			p.resolveSource = n.resolve, "chart" === this._barSource && null !== (this._host.underlyingBars?.() ?? null) && (p.transformed = !0);
			let f = !1;
			if (_ && a <= this._barCount + 1 && null === s && n.canTail && void 0 !== this._d.calcTail) {
				const e = this._barCount - 1, i = this._d.calcTail(t, l, e, this._values, this._store, p);
				null !== i && (h = function(e, t, i, s) {
					const r = {};
					if (Object.keys(e).length !== Object.keys(t).length) return null;
					for (const n of Object.keys(t)) {
						const o = e[n], a = t[n];
						if (void 0 === o || void 0 === a) return null;
						if (o.length !== i + 1 || a.length !== s - i) return null;
						const l = new Array(s);
						for (let e = 0; e < i; e++) l[e] = o[e] ?? null;
						for (let e = i; e < s; e++) l[e] = a[e - i] ?? null;
						r[n] = l;
					}
					return r;
				}(this._values, i, e, a), f = !0);
			}
			if (null === h && (h = this._d.calc(t, l, this._store, p)), o()) {
				null !== s && (h = function(e, t) {
					const i = {};
					for (const s of Object.keys(e)) {
						const r = e[s];
						i[s] = t.map((e) => r[e] ?? null);
					}
					return i;
				}(h, s)), this._sampled = null === s ? null : {
					bars: t,
					sourceIndex: s
				}, this._values = h, this._outputPending = !1, this._dependencyUnavailable = !1, this._studySnapshots = n.snapshots, this._outputRevision++, f || this._outputHistoryRevision++, this._outputSource = r ? { ...r } : void 0, this._barCount = a, this._firstTime = a > 0 ? i[0].time : 0, this._lastTime = a > 0 ? i[a - 1].time : 0, void 0 !== r && (this._sourceId = r.sourceId, this._sourceRevision = r.revision, this._sourceHistoryRevision = r.historyRevision, this._sourceLastTime = t[t.length - 1]?.time), this._writes.begin(i);
				for (const e of this._d.plots) {
					const t = this._series.get(e.key);
					void 0 !== t && (void 0 !== e.ohlc ? this._writes.writeCandles(t, e, e.ohlc, i, h, l, this.indicatorId) : this._writes.writeValues(t, e, h[e.key], i, h, l));
				}
				if (this._syncFills(i), this._syncMarkers(i), this._syncTable(i), this._syncDraws(i), this._syncBackground(i), this._syncBarColors(i), this._applyLevels(i, l), this._alertNeedsSeed) {
					this._alertNeedsSeed = !1;
					const e = {
						...p,
						execution: p.execution ? {
							...p.execution,
							provenance: "history"
						} : void 0
					};
					this._syncAlerts(i, l, !1, e, !1, o);
				} else this._syncAlerts(i, l, _, p, e, o);
				o() && this.updateLegendValues(this._host.legendIndex?.());
			}
		}
		_redate(e, t) {
			this._alertTime === this._lastTime && (this._alertTime = e), t && (this._sourceLastTime = e, this._alertPolicy.redate(this._lastTime, e));
		}
		_applyLevels(e, t) {
			if (void 0 === this._d.levels) return;
			const i = {
				...t,
				settings: t,
				bars: e,
				values: this._values
			}, s = this._visible ? this._d.levels(i) : [];
			let r = "";
			for (const e of s) r += `${e.price}|${e.color ?? ""}|${e.title ?? ""}|${e.dashed ?? ""}|${e.lineWidth ?? ""}|${e.lineStyle ?? ""};`;
			if (r === this._levelSig) return;
			this._levelSig = r;
			for (const e of this._levels) this._host.removeIndicatorLevel(e);
			this._levels = [];
			let n = 0;
			for (const e of s) {
				const t = e.lineStyle ?? (!1 === e.dashed ? "solid" : "dashed");
				this._levels.push(this._host.addIndicatorLevel({
					price: e.price,
					color: e.color ?? "#8892a6",
					dashed: "dashed" === t,
					lineWidth: e.lineWidth ?? 1,
					lineStyle: t,
					label: e.title ?? "",
					id: `${this.id}:level:${n++}`
				}, this.paneIndex)), this._host.bindIndicatorPrimitiveScale?.(this._levels[this._levels.length - 1], this._localScale());
			}
		}
		_applyRange(e) {
			if (this._host.setIndicatorRange) {
				const t = this._d.plots.filter((e) => !0 !== e.overlay).flatMap((e) => {
					const t = this._series.get(e.key);
					return t ? [t] : [];
				});
				this._host.setIndicatorRange(this.id, this.paneIndex, this._localScale(), void 0 === e ? this._d.range?.(this._descriptorSettings()) ?? null : e, t);
				return;
			}
			this._ownPane && this._host.setPaneRange(this.paneIndex, void 0 === e ? this._d.range?.(this._descriptorSettings()) ?? null : e);
		}
		remove(e) {
			if (this._removed || !this._allows("removable", e)) return !1;
			this._removed = !0, this._lifetime.abort(), this._dataRetry = null, this._dataListeners.clear();
			try {
				this._detach?.();
			} catch {}
			this._detach = null;
			for (const e of this._attachedPrimitives) this._host.removeIndicatorPrimitive?.(e);
			this._attachedPrimitives.clear(), null !== this._legend && (this._host.removeIndicatorLegend(this._legend), this._legend = null);
			for (const e of this._levels) this._host.removeIndicatorLevel(e);
			this._levels = [];
			for (const e of this._series.values()) e.remove();
			this._series.clear();
			for (const e of this._fills) this._host.removeIndicatorFill(e);
			this._fills.length = 0, null !== this._markers && (this._host.removeIndicatorMarkers(this._markers), this._markers = null);
			for (const [e] of this._markerLayers.values()) this._host.removeIndicatorMarkers(e);
			this._markerLayers.clear(), null !== this._table && (this._host.removeIndicatorTable(this._table), this._table = null);
			for (const { table: e } of this._tables.values()) this._host.removeIndicatorTable(e);
			this._tables.clear(), null !== this._draws && (this._host.removeIndicatorPrimitive?.(this._draws), this._draws = null);
			for (const e of [...this._drawLayers.values(), ...this._bgLayers.values()]) this._host.removeIndicatorPrimitive?.(e);
			return this._drawLayers.clear(), this._bgLayers.clear(), null !== this._background && (this._host.removeIndicatorPrimitive?.(this._background), this._background = null), this._host.setIndicatorRange?.(this.id, this.paneIndex, this._localScale(), null, []), void 0 !== this._d.barColors && this._host.setBarColors?.(null, this.id), this._ownPane && !this._host.setIndicatorRange && this._host.setPaneRange(this.paneIndex, null), this._host.indicatorRemoved?.(this.id, !this._constructed && this._ownPane ? this.paneIndex : void 0), !0;
		}
	};
	var Jr = [
		"crossing",
		"crossingUp",
		"crossingDown",
		"greaterThan",
		"lessThan",
		"enteringRange",
		"leavingRange"
	];
	var en = [
		"session",
		"adjustment",
		"currency",
		"unit"
	];
	var tn = {
		session: ["regular", "extended"],
		adjustment: ["adjusted", "raw"]
	};
	function sn(e) {
		if (null == e) return;
		const t = e;
		if ("object" != typeof e || Array.isArray(e) || Object.keys(t).some((e) => !en.includes(e))) throw new TypeError("Invalid data variant");
		const i = {};
		for (const e of en) {
			const s = t[e], r = tn[e];
			if (void 0 !== s) {
				if (r ? !r.includes(s) : "string" != typeof s || !s.trim() || s.length > 32) throw new TypeError(`Invalid data ${e}: ${String(s)}`);
				i[e] = s;
			}
		}
		return Object.keys(i).length ? Object.freeze(i) : void 0;
	}
	var hn = (e) => "string" == typeof e && e.trim().length > 0;
	function cn(e) {
		if (!hn(e.id)) throw new Error("Alert id must be nonempty");
		const t = e.source;
		if (!t || ![
			"price",
			"indicator",
			"barCondition",
			"drawing"
		].includes(t.kind)) throw new Error("Unknown alert source");
		if ("barCondition" === t.kind && !hn(t.id)) throw new Error("Invalid bar condition id");
		if (!("indicator" !== t.kind || hn(t.instanceId) && hn(t.plotKey))) throw new Error("Invalid indicator source");
		if (!("drawing" !== t.kind || hn(t.drawingId) && (void 0 === t.level || hn(t.level)) && (void 0 === t.input || t.input && hn(t.input.instanceId) && hn(t.input.plotKey)))) throw new Error("Invalid drawing source");
		if ("barCondition" === t.kind ? "matches" !== e.condition : !Jr.includes(e.condition)) throw new Error("Invalid source condition");
		if ("price" === t.kind || "indicator" === t.kind) {
			const i = "price" === t.kind ? t.price : t.value, s = "price" === t.kind ? t.upperPrice : t.upperValue;
			if (!Number.isFinite(i) || void 0 !== s && !Number.isFinite(s)) throw new Error("Alert bounds must be finite");
			if (("enteringRange" === e.condition || "leavingRange" === e.condition) && (void 0 === s || s < i)) throw new Error("Alert range requires ordered finite bounds");
		}
		if ("onBarClose" !== e.policy && "onTouch" !== e.policy) throw new Error("Unknown alert policy");
		if ("once" !== e.repeat && "everyTime" !== e.repeat) throw new Error("Unknown alert repeat");
		if (![
			"armed",
			"triggered",
			"disabled",
			"expired"
		].includes(e.state)) throw new Error("Unknown alert state");
		if (!Number.isFinite(e.cooldownSeconds) || e.cooldownSeconds < 0) throw new Error("Invalid alert cooldown");
		if ("string" != typeof e.title || void 0 !== e.message && "string" != typeof e.message) throw new Error("Alert title and message must be text");
		const i = un(e.scope);
		for (const e of [
			"symbol",
			"exchange",
			"interval"
		]) if (void 0 !== i[e] && "string" != typeof i[e]) throw new Error("Invalid alert scope");
		if (void 0 !== i.variant) try {
			sn(un(i.variant));
		} catch {
			throw new Error("Invalid alert scope variant");
		}
		for (const t of [
			"expiresAt",
			"lastTriggeredAt",
			"lastTriggeredTime",
			"lastClosedTime",
			"lastTouchedTime"
		]) if (void 0 !== e[t] && !Number.isFinite(e[t])) throw new Error(`Invalid alert ${t}`);
	}
	function dn(e) {
		return {
			...e,
			source: "drawing" === e.source.kind ? {
				...e.source,
				...e.source.input ? { input: { ...e.source.input } } : {}
			} : { ...e.source },
			scope: {
				...e.scope,
				...e.scope.variant ? { variant: { ...e.scope.variant } } : {}
			}
		};
	}
	function un(e) {
		if (null === e || "object" != typeof e || Array.isArray(e) || ![Object.prototype, null].includes(Object.getPrototypeOf(e))) throw new Error("Alert document needs plain JSON records");
		for (const t of Reflect.ownKeys(e)) {
			const i = Object.getOwnPropertyDescriptor(e, t);
			if ("string" != typeof t || !("value" in i) || !i.enumerable) throw new Error("Alert document needs JSON data properties");
		}
		return e;
	}
	function _n(e) {
		if (!Array.isArray(e) || e.length > 1e5 || Reflect.ownKeys(e).length !== e.length + 1) throw new Error("Alert document array is not JSON data");
		return Array.from({ length: e.length }, (t, i) => {
			const s = Object.getOwnPropertyDescriptor(e, String(i));
			if (!s || !("value" in s)) throw new Error("Alert document array needs JSON data values");
			return s.value;
		});
	}
	function pn(e) {
		const t = /* @__PURE__ */ new Set();
		let i = 0, s = 0;
		const r = (e, n) => {
			if (++i > 1e5 || n > 32) throw new Error("Alert payload exceeds JSON limits");
			if (null === e || "boolean" == typeof e) return e;
			if ("string" == typeof e) {
				if (s += e.length, s > 5242880) throw new Error("Alert payload exceeds JSON size limit");
				return e;
			}
			if ("number" == typeof e && Number.isFinite(e)) return e;
			if ("object" != typeof e) throw new Error("Alert payload must be finite JSON data");
			if (t.has(e)) throw new Error("Alert payload contains a cycle");
			let o;
			if (t.add(e), Array.isArray(e)) o = _n(e).map((e) => r(e, n + 1));
			else {
				const t = un(e), i = {};
				for (const e of Object.keys(t)) {
					if (s += e.length, s > 5242880) throw new Error("Alert payload exceeds JSON size limit");
					Object.defineProperty(i, e, {
						value: r(t[e], n + 1),
						enumerable: !0,
						writable: !0,
						configurable: !0
					});
				}
				o = i;
			}
			return t.delete(e), o;
		};
		return r(e, 0);
	}
	function fn(e) {
		if ("string" == typeof e) {
			if (e.length > 5242880) throw new Error("Alert document exceeds JSON size limit");
			e = JSON.parse(e);
		}
		const t = Array.isArray(e) ? {
			version: 1,
			alerts: e
		} : un(e);
		if (1 !== t.version || !Array.isArray(t.alerts) || t.alerts.length > 1e4) throw new Error("Unsupported alert document");
		const i = /* @__PURE__ */ new Set();
		return {
			version: 1,
			alerts: _n(t.alerts).map((e) => {
				const t = un(e), s = un(t.source);
				void 0 !== s.input && un(s.input);
				const r = (e, i) => void 0 === t[e] ? i : t[e], n = un(r("scope", {})), o = {
					id: t.id,
					source: { ...s },
					condition: r("condition", "barCondition" === s.kind ? "matches" : "crossing"),
					policy: r("policy", "onBarClose"),
					repeat: r("repeat", "once"),
					state: r("state", "armed"),
					title: r("title", "Chart alert"),
					cooldownSeconds: r("cooldownSeconds", 0),
					scope: pn(Object.fromEntries(Object.entries(n).filter(([, e]) => void 0 !== e)))
				};
				for (const e of [
					"message",
					"expiresAt",
					"lastTriggeredAt",
					"lastTriggeredTime",
					"lastClosedTime",
					"lastTouchedTime"
				]) void 0 !== t[e] && Object.assign(o, { [e]: t[e] });
				if (cn(o), i.has(o.id)) throw new Error(`Duplicate alert id: ${o.id}`);
				return i.add(o.id), o.source = pn(Object.fromEntries(Object.entries(o.source).filter(([, e]) => void 0 !== e))), void 0 !== t.payload && (o.payload = pn(t.payload)), o;
			})
		};
	}
	function mn(e, t) {
		if (void 0 !== e) for (const i of [...e]) try {
			i(t);
		} catch (e) {
			globalThis.reportError?.(e);
		}
	}
	function bn(e, t) {
		return e.add(t), () => {
			e.delete(t);
		};
	}
	var gn = [
		"Mod",
		"Ctrl",
		"Meta",
		"Alt",
		"Shift"
	];
	var vn = new Set(gn);
	var yn = /* @__PURE__ */ new Set([
		"Shift",
		"Control",
		"Alt",
		"Meta",
		"OS",
		"ShiftLeft",
		"ShiftRight",
		"ControlLeft",
		"ControlRight",
		"AltLeft",
		"AltRight",
		"MetaLeft",
		"MetaRight",
		"OSLeft",
		"OSRight"
	]);
	function wn() {
		return "undefined" != typeof navigator && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || "");
	}
	function xn(e) {
		const t = e.split("+").map((e) => e.trim()).filter((e) => e.length > 0);
		if (0 === t.length) return null;
		const i = t[t.length - 1];
		if (!/^[A-Za-z0-9]+$/.test(i) || vn.has(i)) return null;
		const s = [];
		for (const e of t.slice(0, -1)) {
			if (!vn.has(e)) return null;
			s.includes(e) || s.push(e);
		}
		return s.sort((e, t) => gn.indexOf(e) - gn.indexOf(t)), {
			mods: s,
			key: i
		};
	}
	function Sn(e) {
		const t = xn(e);
		return null === t ? "" : [...t.mods, t.key].join("+");
	}
	function In(e, t = wn()) {
		const i = e.code ?? e.key ?? "";
		if ("" === i || yn.has(i)) return "";
		const s = [];
		return (t ? e.metaKey : e.ctrlKey) && s.push("Mod"), t && e.ctrlKey && s.push("Ctrl"), !t && e.metaKey && s.push("Meta"), e.altKey && s.push("Alt"), e.shiftKey && s.push("Shift"), Sn([...s, i].join("+"));
	}
	var Mn = /* @__PURE__ */ new Set([
		"Mod+KeyW",
		"Mod+KeyT",
		"Mod+KeyN",
		"Mod+KeyQ",
		"Mod+KeyR",
		"Mod+KeyL",
		"Mod+Shift+KeyT",
		"Mod+Shift+KeyN",
		"Mod+Shift+KeyW"
	]);
	function Tn(e) {
		return Mn.has(Sn(e));
	}
	var Cn = [
		{
			command: "panLeft",
			label: "Pan left",
			combos: ["ArrowLeft"]
		},
		{
			command: "panRight",
			label: "Pan right",
			combos: ["ArrowRight"]
		},
		{
			command: "panLeftFast",
			label: "Pan left (fast)",
			combos: ["Mod+ArrowLeft"]
		},
		{
			command: "panRightFast",
			label: "Pan right (fast)",
			combos: ["Mod+ArrowRight"]
		},
		{
			command: "panUp",
			label: "Pan up",
			combos: ["ArrowUp"]
		},
		{
			command: "panDown",
			label: "Pan down",
			combos: ["ArrowDown"]
		},
		{
			command: "zoomIn",
			label: "Zoom in",
			combos: [
				"Equal",
				"Shift+Equal",
				"NumpadAdd"
			]
		},
		{
			command: "zoomOut",
			label: "Zoom out",
			combos: ["Minus", "NumpadSubtract"]
		},
		{
			command: "resetScale",
			label: "Reset view",
			combos: ["Home", "Digit0"]
		},
		{
			command: "fitContent",
			label: "Fit all bars",
			combos: ["Alt+KeyF"]
		},
		{
			command: "screenshot",
			label: "Screenshot (PNG)",
			combos: ["Alt+Shift+KeyS"]
		},
		{
			command: "toggleGridVert",
			label: "Toggle vertical grid",
			combos: ["Alt+KeyV"]
		},
		{
			command: "toggleGridHorz",
			label: "Toggle horizontal grid",
			combos: ["Alt+KeyH"]
		},
		{
			command: "toggleCrosshairMagnet",
			label: "Toggle crosshair magnet",
			combos: ["Alt+KeyM"]
		}
	];
	var jn = {
		panLeftFast: ["Alt+ArrowLeft"],
		panRightFast: ["Alt+ArrowRight"],
		screenshot: ["Mod+Shift+KeyS"]
	};
	new Set(Cn.map((e) => e.command));
	var Ln = (e) => Array.isArray(e) ? e : [e];
	var Nn = class {
		constructor(e = {}) {
			Object.defineProperty(this, "scope", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_isMac", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_persist", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_storageKey", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_preset", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_overrides", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: {}
			}), Object.defineProperty(this, "_disabled", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Set()
			}), Object.defineProperty(this, "_custom", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_entries", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_reverse", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_listeners", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Set()
			}), Object.defineProperty(this, "_changes", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Set()
			}), this.scope = e.scope ?? "hover", this._isMac = e.isMac ?? wn(), this._persist = e.persist ?? !1, this._storageKey = e.storageKey ?? "openalgo-charts:shortcuts", this._preset = e.preset ?? "default";
			const t = (e) => {
				for (const [t, i] of Object.entries(e ?? {})) {
					if (null === i) {
						this._disabled.add(t);
						continue;
					}
					const e = Ln(i).map(Sn).filter((e) => "" !== e && !Tn(e));
					this._overrides[t] = e;
				}
			};
			t(e.overrides);
			for (const t of e.disabledCommands ?? []) this._disabled.add(t);
			for (const t of e.customShortcuts ?? []) this._custom.set(t.command, t);
			const i = this._load();
			if (null !== i) {
				void 0 !== i.preset && (this._preset = i.preset), t(i.overrides);
				for (const e of i.disabled ?? []) this._disabled.add(e);
			}
			this._rebuild();
		}
		_presetCombos(e) {
			return "alt" === this._preset ? jn[e] : void 0;
		}
		_effectiveCombos(e, t) {
			return this._disabled.has(e) ? [] : void 0 !== this._overrides[e] ? this._overrides[e] : this._presetCombos(e) ?? t;
		}
		_rebuild() {
			this._entries = /* @__PURE__ */ new Map();
			for (const e of Cn) this._entries.set(e.command, {
				command: e.command,
				label: e.label,
				combos: this._effectiveCombos(e.command, e.combos)
			});
			for (const e of this._custom.values()) this._entries.set(e.command, {
				command: e.command,
				label: e.label ?? e.command,
				combos: this._effectiveCombos(e.command, Ln(e.combos).map(Sn).filter((e) => "" !== e))
			});
			this._reverse = /* @__PURE__ */ new Map();
			for (const e of this._entries.values()) for (const t of e.combos) this._reverse.has(t) || this._reverse.set(t, e.command);
		}
		resolve(e) {
			const t = In(e, this._isMac);
			return "" === t ? null : this._reverse.get(t) ?? null;
		}
		handleKey(e) {
			return this._reverse.get(Sn(e)) ?? null;
		}
		runCustom(e) {
			const t = this._custom.get(e);
			return void 0 !== t && (t.onTrigger(), this.emitTrigger(e), !0);
		}
		emitTrigger(e, t = "") {
			const i = {
				command: e,
				combo: t,
				isCustom: this._custom.has(e)
			};
			mn(this._listeners, i);
		}
		on(e) {
			return this._listeners.add(e), () => this._listeners.delete(e);
		}
		onChange(e) {
			return this._changes.add(e), () => {
				this._changes.delete(e);
			};
		}
		setBinding(e, t) {
			const i = Ln(t).map(Sn).filter((e) => "" !== e && !Tn(e));
			return 0 !== i.length && (this._overrides[e] = i, this._disabled.delete(e), this._after(), !0);
		}
		disable(e) {
			this._disabled.add(e), delete this._overrides[e], this._after();
		}
		resetBinding(e) {
			delete this._overrides[e], this._disabled.delete(e), this._after();
		}
		resetAll() {
			this._overrides = {}, this._disabled.clear(), this._after();
		}
		setPreset(e) {
			this._preset = e, this._after();
		}
		addCustom(e) {
			this._custom.set(e.command, e), this._after();
		}
		list() {
			return [...this._entries.values()].map((e) => ({
				command: e.command,
				label: e.label,
				combos: e.combos,
				isCustom: this._custom.has(e.command),
				isDisabled: this._disabled.has(e.command)
			}));
		}
		state() {
			return {
				preset: this._preset,
				overrides: this._overrides,
				disabled: [...this._disabled]
			};
		}
		_after() {
			this._rebuild(), this._save();
			for (const e of [...this._changes]) e();
		}
		_save() {
			if (this._persist && "undefined" != typeof localStorage) try {
				localStorage.setItem(this._storageKey, JSON.stringify(this.state()));
			} catch {}
		}
		_load() {
			if (!this._persist || "undefined" == typeof localStorage) return null;
			try {
				const e = localStorage.getItem(this._storageKey);
				return null === e ? null : JSON.parse(e);
			} catch {
				return null;
			}
		}
		static shouldIgnore(e) {
			const t = e;
			if (null == t) return !1;
			if (!0 === t.isContentEditable) return !0;
			const i = (t.tagName ?? "").toUpperCase();
			return "INPUT" === i || "TEXTAREA" === i || "SELECT" === i;
		}
	};
	function Rn(e, t, i, s, r, n, o, a) {
		if ("hidden" === t.priceAxisSide || !(t.priceAxisWidth > 0)) return;
		const l = t.dpr, h = 6 * l, c = "left" === t.priceAxisSide;
		if (c || void 0 !== t.priceAxisOffset) {
			const d = t.priceAxisOffset ?? 0, u = Math.round(d * l), _ = Math.round((d + (c ? -t.priceAxisWidth : t.priceAxisWidth)) * l), p = a || void 0 !== t.priceAxisOffset, f = (p ? Math.abs(_ - u) : Math.round(t.priceAxisWidth * l)) - 1, m = t.plotHeight * l;
			if (Number.isFinite(u) && Number.isFinite(_) && f > 0 && m >= o) {
				e.save(), p && (e.beginPath(), e.rect(Math.min(u, _), 0, f + 1, m), e.clip());
				const t = Math.min(h, f / 4), a = e.measureText(s).width, d = Math.min(f, a + 2 * t), b = c ? u - 1 - d : u + 1, g = Math.max(o / 2, Math.min(m - o / 2, i));
				e.fillStyle = r, e.fillRect(b, g - o / 2, d, o), e.fillStyle = n, e.font = `500 ${11 * l * (a > 0 ? Math.min(1, (d - 2 * t) / a) : 1)}px system-ui, sans-serif`, e.fillText(s, b + t, g), e.restore(), e.font = `500 ${11 * l}px system-ui, sans-serif`;
			}
		} else {
			const a = Math.round(t.plotWidth * l);
			e.fillStyle = r, e.fillRect(a + 1, i - o / 2, e.measureText(s).width + 2 * h, o), e.fillStyle = n, e.fillText(s, a + 1 + h, i);
		}
	}
	var Fn = class {
		constructor(e) {
			Object.defineProperty(this, "_opts", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_ghostPrice", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_group", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), this._opts = e;
		}
		attached(e) {
			this._host = e;
		}
		detached() {
			this._host = null;
		}
		get price() {
			return this._opts.price;
		}
		setPrice(e) {
			this._opts.price = e, this._host?.requestUpdate();
		}
		setLeftLabel(e) {
			this._opts.leftLabel = e, this._host?.requestUpdate();
		}
		setOptions(e) {
			this._opts = {
				...this._opts,
				...e
			}, this._host?.requestUpdate();
		}
		setDragGhost(e) {
			this._ghostPrice = e, this._host?.requestUpdate();
		}
		options() {
			return this._opts;
		}
		zOrder() {
			return "normal";
		}
		autoscaleInfo() {
			return {
				min: this._opts.price,
				max: this._opts.price
			};
		}
		draw(e, t) {
			this._group = null;
			const i = Math.round(t.priceScale.priceToY(this._opts.price) * t.dpr) + .5, s = "left" === t.priceAxisSide ? i - .5 : i;
			if (!Number.isFinite(i) || s < 0 || s > t.plotHeight * t.dpr) return;
			const r = t.dpr, n = this._opts.lineWidth ?? 1, o = Math.round(t.plotWidth * r), a = Math.max(0, Math.min(1, this._opts.extentFromRight ?? 1)), l = Math.round(t.plotWidth * (1 - a) * r), h = this._opts.color, c = void 0 !== this._opts.cursor || !0 === this._opts.closeButton, d = t.dragId === this._opts.id, u = c && !d && (t.hoverId === this._opts.id || t.hoverId === `${this._opts.id}::close`), _ = t.hoverId === `${this._opts.id}::close`;
			if (e.save(), null !== this._ghostPrice && d) {
				const i = Math.round(t.priceScale.priceToY(this._ghostPrice) * r) + .5;
				i >= 0 && i <= t.plotHeight * r && (e.strokeStyle = ie(h, .35), e.lineWidth = Math.max(1, Math.round(r)), e.setLineDash([2 * r, 3 * r]), e.beginPath(), e.moveTo(l, i), e.lineTo(o, i), e.stroke(), e.setLineDash([]));
			}
			d && (e.strokeStyle = ie(h, .18), e.lineWidth = Math.max(5 * r, Math.round(n * r) + 4 * r), e.beginPath(), e.moveTo(l, i), e.lineTo(o, i), e.stroke()), e.strokeStyle = u || d ? re(h, .1) : h;
			const p = Math.max(1, Math.round(n * r));
			e.lineWidth = u || d ? p + Math.round(r) : p, e.setLineDash(z(this._opts.lineStyle ?? (!0 === this._opts.dashed ? "dashed" : "solid"), r)), e.beginPath(), e.moveTo(l, i), e.lineTo(o, i), e.stroke(), e.setLineDash([]), e.font = `500 ${11 * r}px system-ui, sans-serif`, e.textBaseline = "middle", e.textAlign = "left";
			const f = 18 * r, m = 6 * r, b = 3 * r;
			Rn(e, t, i, this._opts.label ?? t.priceScale.format(this._opts.price), d || u ? re(h, .12) : h, Q(h), f, !1);
			if (void 0 !== this._opts.badge || void 0 !== this._opts.qty || void 0 !== this._opts.leftLabel && "" !== this._opts.leftLabel || !0 === this._opts.closeButton) {
				const s = "transparent" === t.theme.background, n = s ? ie(h, .14) : t.theme.background, o = s ? t.theme.axisText : Q(t.theme.background), c = ie(t.theme.axisText, u || d ? .75 : .5), p = [];
				void 0 !== this._opts.badge && p.push({
					text: this._opts.badge,
					fill: d ? re(h, .2) : u ? re(h, .12) : h,
					textColor: Q(h),
					border: re(h, -.25)
				}), void 0 !== this._opts.qty && p.push({
					text: String(this._opts.qty),
					fill: n,
					textColor: o,
					border: c
				}), void 0 !== this._opts.leftLabel && "" !== this._opts.leftLabel && p.push({
					text: this._opts.leftLabel,
					fill: n,
					textColor: o,
					border: c
				}), !0 === this._opts.closeButton && p.push({
					close: !0,
					fill: _ ? h : n,
					textColor: _ ? Q(h) : o,
					border: _ ? h : c
				}), this._group = function(e, t, i, s, r) {
					const { height: n, padX: o, radius: a, gap: l, dpr: h } = r, c = s.map((t) => !0 === t.close ? 20 * h : e.measureText(t.text ?? "").width + 2 * o), d = c.reduce((e, t) => e + t, 0) + l * Math.max(0, s.length - 1);
					void 0 !== r.backplate && (e.beginPath(), ne(e, t, i - n / 2, d, n, a), e.fillStyle = r.backplate, e.fill());
					let u = Number.POSITIVE_INFINITY, _ = t;
					for (let t = 0; t < s.length; t++) {
						const r = s[t], d = c[t];
						if (e.beginPath(), ne(e, _, i - n / 2, d, n, a), e.fillStyle = r.fill, e.fill(), void 0 !== r.border && (e.strokeStyle = r.border, e.lineWidth = Math.max(1, Math.round(h)), e.stroke()), !0 === r.close) {
							u = _, e.strokeStyle = r.textColor, e.lineWidth = Math.max(1, Math.round(1.4 * h));
							const t = _ + d / 2, s = 3.5 * h;
							e.beginPath(), e.moveTo(t - s, i - s), e.lineTo(t + s, i + s), e.moveTo(t + s, i - s), e.lineTo(t - s, i + s), e.stroke();
						} else e.fillStyle = r.textColor, e.textAlign = "left", e.textBaseline = "middle", e.fillText(r.text ?? "", _ + o, i);
						_ += d + l;
					}
					return {
						x0: t / h,
						x1: (_ - l) / h,
						closeX0: u / h
					};
				}(e, l + (1 === a ? 6 * r : 0), i, p, {
					height: f,
					padX: m,
					radius: b,
					gap: 2 * r,
					backplate: s ? void 0 : t.theme.background,
					dpr: r
				});
			}
			e.restore();
		}
		hitTest(e, t, i) {
			if (e < 0 || e > i.plotWidth) return null;
			const s = i.priceScale.priceToY(this._opts.price), r = Math.abs(t - s), n = this._group;
			return null !== n && r <= 10 && e >= n.x0 && e <= n.x1 ? this._opts.closeButton && e >= n.closeX0 ? {
				externalId: `${this._opts.id}::close`,
				zOrder: "normal",
				distance: r,
				cursor: "pointer"
			} : {
				externalId: this._opts.id,
				zOrder: "normal",
				distance: r,
				cursor: this._opts.cursor
			} : r > 4 ? null : {
				externalId: this._opts.id,
				zOrder: "normal",
				distance: r,
				cursor: this._opts.cursor
			};
		}
	};
	var zn = {
		long: "#2f6df6",
		short: "#ef5350",
		order: "#3b82f6",
		tp: "#26a69a",
		sl: "#ef5350",
		buy: "#26a69a",
		sell: "#ef5350"
	};
	var En = "::close";
	function Bn(e, t) {
		const i = e.length;
		if (0 === i) return;
		let s = 0, r = i - 1;
		for (; s < r;) {
			const i = s + r + 1 >> 1, n = e.indexToTime(i);
			void 0 !== n && n <= t ? s = i : r = i - 1;
		}
		const n = e.indexToTime(s);
		if (void 0 !== n) {
			if (s + 1 < i) {
				const i = e.indexToTime(s + 1);
				if (void 0 !== i && Math.abs(i - t) < Math.abs(n - t)) return s + 1;
			}
			return s;
		}
	}
	function $n(e, t, i, s, r, n) {
		const o = 5 * n;
		e.fillStyle = r, e.beginPath(), "buy" === s ? (e.moveTo(t, i - 1.5 * o), e.lineTo(t - o, i), e.lineTo(t + o, i)) : (e.moveTo(t, i + 1.5 * o), e.lineTo(t - o, i), e.lineTo(t + o, i)), e.closePath(), e.fill();
	}
	function Dn(e, t, i, s, r, n) {
		const o = 9 * n;
		e.fillStyle = s, e.beginPath(), e.arc(t, i, o, 0, 2 * Math.PI), e.fill(), "" !== r && (e.fillStyle = Q(s), e.font = `500 ${9 * n}px system-ui, sans-serif`, e.textAlign = "center", e.textBaseline = "middle", e.fillText(r, t, i + .5 * n));
	}
	function Wn(e, t, i, s, r, n) {
		const o = String(s);
		e.font = `500 ${9 * n}px system-ui, sans-serif`;
		const a = e.measureText(o).width + 10 * n, l = 15 * n;
		e.fillStyle = r, e.beginPath(), ne(e, Math.round(t - a / 2), Math.round(i - l / 2), Math.round(a), Math.round(l), 3 * n), e.fill(), e.fillStyle = Q(r), e.textAlign = "center", e.textBaseline = "middle", e.fillText(o, t, i + .5 * n);
	}
	var qn = class {
		constructor(e) {
			Object.defineProperty(this, "_trades", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_colors", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), this._colors = e;
		}
		attached(e) {
			this._host = e;
		}
		detached() {
			this._host = null;
		}
		zOrder() {
			return "top";
		}
		autoscaleInfo() {
			return null;
		}
		setTrades(e) {
			this._trades = e, this._host?.requestUpdate();
		}
		setColors(e) {
			this._colors = e, this._host?.requestUpdate();
		}
		draw(e, t) {
			if (0 === this._trades.length) return;
			const i = t.dpr, s = /* @__PURE__ */ new Map();
			e.save();
			for (const r of this._trades) {
				const n = Bn(t.dataLayer, Math.floor(r.timestamp / 1e3));
				if (void 0 === n) continue;
				const o = Math.round(t.timeScale.indexToX(n) * i), a = r.color ?? ("buy" === r.side ? this._colors.buy : this._colors.sell), l = r.variant ?? "chevron";
				if ("count" === l) {
					const e = `${n}:${r.side}`;
					let t = s.get(e);
					void 0 === t && (t = {
						index: n,
						sumPS: 0,
						sumS: 0,
						n: 0,
						color: a
					}, s.set(e, t)), t.sumPS += r.price * r.size, t.sumS += r.size, t.n += 1;
					continue;
				}
				const h = Math.round(t.priceScale.priceToY(r.price) * i);
				"bubble" === l ? Dn(e, o, h, a, r.label ?? ("buy" === r.side ? "B" : "S"), i) : $n(e, o, h, r.side, a, i);
			}
			for (const r of s.values()) {
				const s = r.sumS > 0 ? r.sumPS / r.sumS : 0;
				Wn(e, Math.round(t.timeScale.indexToX(r.index) * i), Math.round(t.priceScale.priceToY(s) * i), r.n, r.color, i);
			}
			e.restore();
		}
	};
	var Vn = class {
		constructor(e) {
			Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_positions", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_orders", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_trades", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_listeners", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_dragPrev", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_colors", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: { ...zn }
			}), Object.defineProperty(this, "_markers", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_ticks", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), this._host = e, this._ticks = e.tickSchedule?.() ?? null, e.subscribeClick((e) => this._onClick(e)), e.subscribeDrag((e, t) => this._onDrag(e, t), (e, t) => this._onDragEnd(e, t));
		}
		on(e, t) {
			let i = this._listeners.get(e);
			return void 0 === i && (i = /* @__PURE__ */ new Set(), this._listeners.set(e, i)), i.add(t), () => {
				this._listeners.get(e)?.delete(t);
			};
		}
		off(e, t) {
			this._listeners.get(e)?.delete(t);
		}
		_emit(e, t) {
			mn(this._listeners.get(e), t), this._host.emit?.(e, t);
		}
		setSettings(e) {
			void 0 !== e.longColor && (this._colors.long = e.longColor), void 0 !== e.shortColor && (this._colors.short = e.shortColor), void 0 !== e.orderColor && (this._colors.order = e.orderColor), void 0 !== e.tpColor && (this._colors.tp = e.tpColor), void 0 !== e.slColor && (this._colors.sl = e.slColor), void 0 !== e.buyColor && (this._colors.buy = e.buyColor), void 0 !== e.sellColor && (this._colors.sell = e.sellColor), this.setPositions(this.getPositions()), this.setOrders(this.getOrders()), this._markers?.setColors(this._colors);
		}
		getSettings() {
			return { ...this._colors };
		}
		setTickSchedule(e) {
			if (null != e && "function" != typeof e.round) throw new TypeError("chart.trading.setTickSchedule takes a schedule built with new TickSchedule(bands), or null");
			this._ticks = e ?? null;
		}
		setPositions(e) {
			this._sync(this._positions, e, "pos");
		}
		setOrders(e) {
			this._sync(this._orders, e, "ord");
		}
		setTrades(e) {
			this._trades.clear();
			for (const t of e) this._trades.set(t.id, t);
			this._renderTrades();
		}
		addTrade(e) {
			this._trades.set(e.id, e), this._renderTrades();
		}
		upsertOrder(e) {
			const t = this.getOrders().filter((t) => t.id !== e.id);
			t.push(e), this.setOrders(t);
		}
		removeOrder(e) {
			const t = this.getOrders().filter((t) => t.id !== e && t.parentId !== e);
			this.setOrders(t);
		}
		syncState(e) {
			void 0 !== e.positions && this.setPositions(e.positions), void 0 !== e.orders && this.setOrders(e.orders), void 0 !== e.trades && this.setTrades(e.trades);
		}
		updatePositionPnl(e, ...t) {
			const i = this._positions.get(e);
			if (void 0 === i) return;
			const [s, r] = "string" == typeof t[0] ? t : t.slice(1);
			"string" == typeof s && (i.entity.pnlText = s), "string" == typeof r && (i.entity.pnlPercent = r), i.line.setLeftLabel(this._positionPill(i.entity));
		}
		getPositions() {
			return [...this._positions.values()].map((e) => e.entity);
		}
		getOrders() {
			return [...this._orders.values()].map((e) => e.entity);
		}
		getTrades() {
			return [...this._trades.values()];
		}
		clear() {
			for (const e of this._positions.values()) this._host.removePrimitive(e.line);
			for (const e of this._orders.values()) this._host.removePrimitive(e.line);
			this._positions.clear(), this._orders.clear(), this._trades.clear(), null !== this._markers && (this._host.removePrimitive(this._markers), this._markers = null);
		}
		_renderTrades() {
			null === this._markers && (this._markers = new qn(this._colors), this._host.addPrimitive(this._markers)), this._markers.setTrades(this.getTrades());
		}
		_sync(e, t, i) {
			const s = /* @__PURE__ */ new Set();
			for (const r of t) {
				s.add(r.id);
				const t = "pos" === i ? this._positionOpts(r) : this._orderOpts(r), n = this._sig(t), o = e.get(r.id);
				if (void 0 !== o && o.sig === n) o.entity = r, o.line.setPrice(t.price), void 0 !== t.leftLabel && o.line.setLeftLabel(t.leftLabel);
				else {
					void 0 !== o && this._host.removePrimitive(o.line);
					const i = new Fn(t);
					this._host.addPrimitive(i), e.set(r.id, {
						entity: r,
						line: i,
						sig: n
					});
				}
			}
			for (const [t, i] of e) s.has(t) || (this._host.removePrimitive(i.line), e.delete(t));
		}
		_sig(e) {
			return `${e.color}|${e.dashed}|${!0 === e.closeButton}|${e.cursor ?? ""}|${void 0 !== e.leftLabel}|${e.badge ?? ""}|${e.qty ?? ""}`;
		}
		_positionPill(e) {
			return void 0 === e.pnlText ? "" : `${e.pnlText}${void 0 !== e.pnlPercent ? ` (${e.pnlPercent})` : ""}`;
		}
		_positionOpts(e) {
			const t = "line-only" === e.variant;
			return {
				price: e.entryPrice,
				color: e.color ?? ("long" === e.side ? this._colors.long : this._colors.short),
				lineWidth: 2,
				dashed: !1,
				id: `pos:${e.id}`,
				badge: t ? void 0 : e.side.toUpperCase(),
				qty: t ? void 0 : e.size,
				leftLabel: t ? void 0 : this._positionPill(e),
				closeButton: !t && !0 !== e.readOnly,
				extentFromRight: .3
			};
		}
		_orderOpts(e) {
			const t = "line-only" === e.variant, i = !t && (e.draggable ?? !0 !== e.readOnly), s = e.color ?? ("tp" === e.bracketRole ? this._colors.tp : "sl" === e.bracketRole ? this._colors.sl : this._colors.order);
			return {
				price: e.price,
				color: s,
				lineWidth: e.lineWidth ?? 1,
				dashed: "solid" !== (e.lineStyle ?? "solid"),
				id: `ord:${e.id}`,
				badge: t ? void 0 : (e.bracketRole ?? e.side).toUpperCase(),
				qty: t ? void 0 : e.size,
				leftLabel: t || void 0 !== e.bracketRole ? void 0 : e.type.replace("_", " ").toUpperCase(),
				closeButton: !t && !0 !== e.readOnly,
				extentFromRight: .3,
				cursor: i ? "ns-resize" : void 0
			};
		}
		_onClick(e) {
			if (e.endsWith(En)) {
				const t = e.slice(0, -7);
				if (t.startsWith("ord:")) {
					const e = t.slice(4);
					this._orders.has(e) && this._emit("trading:order_cancel", { orderId: e });
				} else if (t.startsWith("pos:")) {
					const e = t.slice(4);
					this._positions.has(e) && this._emit("trading:position_close", { positionId: e });
				}
				return;
			}
			if (e.startsWith("ord:")) {
				const t = this._orders.get(e.slice(4));
				void 0 !== t && this._emit("trading:order_click", { order: t.entity });
			} else if (e.startsWith("pos:")) {
				const t = this._positions.get(e.slice(4));
				void 0 !== t && this._emit("trading:position_click", { position: t.entity });
			}
		}
		_onDrag(e, t) {
			if (!e.startsWith("ord:")) return;
			const i = this._ticks?.round(t) ?? t, s = this._orders.get(e.slice(4));
			if (void 0 === s) return;
			const r = e.slice(4);
			this._dragPrev.has(r) || (this._dragPrev.set(r, s.entity.price), s.line.setDragGhost(s.entity.price)), s.line.setPrice(i);
		}
		_onDragEnd(e, t) {
			if (!e.startsWith("ord:")) return;
			const i = this._ticks?.round(t) ?? t, s = e.slice(4), r = this._orders.get(s);
			if (void 0 === r) return;
			const n = this._dragPrev.get(s) ?? r.entity.price;
			this._dragPrev.delete(s), r.line.setDragGhost(null), r.entity.price = i, r.line.setPrice(i), void 0 !== r.entity.bracketRole ? this._emit("trading:bracket_modify", {
				parentId: r.entity.parentId,
				bracketRole: r.entity.bracketRole,
				newPrice: i
			}) : this._emit("trading:order_modify", {
				orderId: s,
				newPrice: i,
				previousPrice: n
			});
		}
	};
	var Hn = /* @__PURE__ */ new WeakMap();
	var Gn = /* @__PURE__ */ new WeakMap();
	function Un(e) {
		Gn.set(e, {}), Hn.get(e)?.();
	}
	function Yn(e, t, i, s) {
		if ("price" !== t && "time" !== t && "point" !== t) throw new TypeError("Invalid pick kind");
		const r = {};
		Gn.set(e, r);
		let n = !1, o = !1;
		const a = [], l = (s) => {
			if (n) {
				n = !1, Hn.get(e) === h && Hn.delete(e);
				try {
					e.emit("pick:end", {
						kind: t,
						value: s
					}), null === s || o || Gn.get(e) !== r || i(s);
				} finally {
					for (const e of a.splice(0)) e();
				}
			}
		}, h = Object.assign(() => {
			o = !0, l(null);
		}, { active: () => n });
		for (const t of [
			"destroy",
			"state:restore:start",
			"data:context",
			"paneRemoved",
			"paneMoved"
		]) a.push(e.on(t, h));
		if (a.push(e.on("data:update", (e) => {
			"reset" === e?.kind && h();
		})), Hn.get(e)?.(), o || Gn.get(e) !== r) {
			for (const e of a.splice(0)) e();
			return h;
		}
		n = !0;
		const c = (t) => {
			const i = e.dataLayer;
			return i.indexToTime(Math.round(i.timeToIndexFloat(t))) ?? t;
		};
		return a.push(e.on("click", (e) => {
			if (!n) return;
			const i = e, r = s ? s(e) : "price" === t ? i.price : "time" === t ? i.time : {
				time: i.time,
				price: i.price
			};
			if (null === r) return;
			if ("object" == typeof r) {
				const e = Number.isFinite(r.time) ? c(r.time) : NaN, { price: t } = r;
				Number.isFinite(e) && null !== t && Number.isFinite(t) && l({
					time: e,
					price: t
				});
				return;
			}
			const o = Number.isFinite(r) && "time" === t ? c(r) : r;
			Number.isFinite(o) && l(o);
		})), Hn.set(e, h), e.emit("pick:start", { kind: t }), h;
	}
	var Xn = {
		earnings: "#f0a020",
		dividend: "#26a69a",
		split: "#4f8cff",
		news: "#9aa0b4"
	};
	function Jn(e) {
		return Array.isArray(e) ? e.map(Jn) : ts(e) ? Object.fromEntries(Object.entries(e).map(([e, t]) => [e, Jn(t)])) : e;
	}
	function Zn(e) {
		return {
			...e,
			..."object" == typeof e.details ? { details: Jn(e.details) } : {}
		};
	}
	var Qn = class {
		constructor(e = {}) {
			Object.defineProperty(this, "_entries", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_groups", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_options", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: {
					clustering: !1,
					clusterRadius: 18
				}
			}), Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_positions", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_hits", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_providedIds", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Set()
			}), Object.defineProperty(this, "_duplicateIds", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Set()
			}), Object.defineProperty(this, "_width", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_height", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), this.setOptions(e);
		}
		attached(e) {
			this._host = e;
		}
		detached() {
			this._host = null, this._invalidate();
		}
		zOrder() {
			return "normal";
		}
		setEvents(e) {
			const t = e.map((e) => {
				if (!Number.isFinite(e.time)) throw new Error("openalgo-charts: event time must be finite");
				return Zn(e);
			}).sort((e, t) => e.time - t.time), i = /* @__PURE__ */ new Map();
			this._entries = t.map((e) => {
				const t = void 0 === e.id ? JSON.stringify([
					e.time,
					e.type,
					e.label,
					e.group ?? null
				]) : JSON.stringify(e.id), s = i.get(t) ?? 0;
				return i.set(t, s + 1), {
					event: e,
					key: `${t}:${s}`
				};
			}), this._providedIds = new Set(t.flatMap((e) => void 0 === e.id ? [] : [e.id])), this._duplicateIds = new Set([...this._providedIds].filter((e) => (i.get(JSON.stringify(e)) ?? 0) > 1)), this._invalidate();
		}
		events() {
			return this._entries.map((e) => Zn(e.event));
		}
		setGroups(e) {
			const t = /* @__PURE__ */ new Map();
			for (const i of e) {
				if (!i.id || t.has(i.id)) throw new Error("openalgo-charts: event group IDs must be nonempty and unique");
				t.set(i.id, { ...i });
			}
			const i = /* @__PURE__ */ new Set();
			for (const e of t.keys()) {
				const s = /* @__PURE__ */ new Set();
				let r = e;
				for (; void 0 !== r && !i.has(r);) {
					if (s.has(r)) throw new Error("openalgo-charts: event group cycle");
					const e = t.get(r);
					if (void 0 === e) throw new Error("openalgo-charts: event group parent is missing");
					s.add(r), r = e.parentId;
				}
				for (const e of s) i.add(e);
			}
			this._groups = t, this._invalidate();
		}
		groups() {
			return Array.from(this._groups.values(), (e) => ({ ...e }));
		}
		setGroupVisible(e, t) {
			const i = this._groups.get(e);
			if (void 0 === i) throw new Error(`openalgo-charts: unknown event group ${e}`);
			i.visible = t, this._invalidate();
		}
		isGroupVisible(e) {
			let t = this._groups.get(e);
			for (; void 0 !== t;) {
				if (!1 === t.visible) return !1;
				t = void 0 === t.parentId ? void 0 : this._groups.get(t.parentId);
			}
			return !0;
		}
		setOptions(e) {
			const t = e.clusterRadius ?? this._options.clusterRadius;
			if (!Number.isFinite(t) || t < 1 || t > 200) throw new Error("openalgo-charts: event clusterRadius must be from 1 to 200");
			this._options = {
				clustering: e.clustering ?? this._options.clustering,
				clusterRadius: t
			}, this._invalidate();
		}
		options() {
			return { ...this._options };
		}
		detailsForHit(e) {
			const t = this._hits.get(e);
			return void 0 === t ? null : {
				id: t.id,
				cluster: t.entries.length > 1,
				events: t.entries.map((e) => Zn(e.event))
			};
		}
		draw(e, t) {
			if (this._positions = [], this._hits.clear(), this._width = t.plotWidth, this._height = t.plotHeight, !(0 !== this._entries.length && t.dpr > 0 && Number.isFinite(t.dpr) && t.plotWidth > 0 && t.plotHeight > 0)) return;
			const i = [];
			for (const e of this._entries) {
				if (void 0 !== e.event.group && !this.isGroupVisible(e.event.group)) continue;
				const s = t.dataLayer.timeToIndexFloat(e.event.time), r = t.timeScale.indexToX(s);
				if (!Number.isFinite(r)) continue;
				const n = i[i.length - 1];
				this._options.clustering && void 0 !== n && r - n.firstX <= this._options.clusterRadius ? (n.entries.push(e), n.x += (r - n.x) / n.entries.length) : i.push({
					x: r,
					firstX: r,
					entries: [e]
				});
			}
			const s = t.plotHeight - 8 - 4;
			e.save(), e.beginPath(), e.rect(0, 0, t.plotWidth * t.dpr, t.plotHeight * t.dpr), e.clip(), e.textAlign = "center", e.textBaseline = "middle", e.font = 10 * t.dpr + "px system-ui, sans-serif";
			for (const r of i) {
				if (r.x + 8 < 0 || r.x - 8 > t.plotWidth || s + 8 < 0) continue;
				const i = r.entries[0].event, n = r.entries.length > 1;
				let o = i.id;
				if (n || void 0 === o || this._duplicateIds.has(o)) for (o = `${n ? "event-cluster:" : "event:"}${JSON.stringify(r.entries.map((e) => e.key).sort())}`; this._providedIds.has(o);) o = ":" + o;
				e.fillStyle = i.color ?? Xn[i.type] ?? "#9aa0b4", e.beginPath(), e.arc(r.x * t.dpr, s * t.dpr, 8 * t.dpr, 0, 2 * Math.PI), e.fill(), e.fillStyle = "#0d0e12";
				const a = n ? r.entries.length > 99 ? "99+" : String(r.entries.length) : i.label.slice(0, 2);
				e.fillText(a, r.x * t.dpr, s * t.dpr);
				const l = {
					id: o,
					x: r.x,
					y: s,
					r: 8,
					entries: r.entries
				};
				this._positions.push(l), this._hits.set(o, l);
			}
			e.restore();
		}
		hitTest(e, t) {
			if (e < 0 || t < 0 || e > this._width || t > this._height) return null;
			let i = null;
			for (const s of this._positions) {
				const r = Math.hypot(s.x - e, s.y - t);
				r <= s.r && (null === i || r <= i.distance) && (i = {
					externalId: s.id,
					zOrder: "normal",
					distance: r,
					cursor: "pointer"
				});
			}
			return i;
		}
		_invalidate() {
			this._positions = [], this._hits.clear(), this._host?.requestUpdate();
		}
	};
	var eo = {
		zoomOut: "Zoom out",
		zoomIn: "Zoom in",
		resetScale: "Reset view",
		panLeftBar: "Move left",
		panRightBar: "Move right"
	};
	var to = {
		id: "timenav",
		buttons: [
			"zoomOut",
			"zoomIn",
			null,
			"resetScale",
			null,
			"panLeftBar",
			"panRightBar"
		],
		size: 26,
		gap: 4,
		groupGap: 16,
		bottomMargin: 10,
		revealHeight: 64,
		fadeSeconds: .12,
		labels: eo,
		hints: {},
		showTooltip: !0,
		font: 11,
		radius: 6,
		zOrder: "top"
	};
	var io = class {
		constructor(e = {}, t) {
			Object.defineProperty(this, "_opts", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_boxes", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_pointer", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_opacity", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_lastFrameMs", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_now", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_revealTop", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 1 / 0
			}), this._opts = {
				...to,
				...e,
				labels: {
					...to.labels,
					...e.labels
				}
			}, this._now = t ?? (() => "undefined" != typeof performance ? performance.now() : 0);
		}
		attached(e) {
			this._host = e;
		}
		detached() {
			this._host = null;
		}
		zOrder() {
			return this._opts.zOrder ?? "top";
		}
		options() {
			return this._opts;
		}
		setOptions(e) {
			this._opts = {
				...this._opts,
				...e,
				labels: {
					...this._opts.labels,
					...e.labels
				}
			}, this._host?.requestUpdate();
		}
		setPointer(e) {
			const t = this._pointer;
			this._pointer = e, (null === t != (null === e) || this._opacity > 0 || this._targetOpacity() > 0) && this._host?.requestUpdate();
		}
		_revealed() {
			return null !== this._pointer && this._pointer.y >= this._revealTop;
		}
		_targetOpacity() {
			return this._revealed() ? 1 : 0;
		}
		animating() {
			return Math.abs(this._targetOpacity() - this._opacity) > .001;
		}
		draw(e, t) {
			const i = this._opts, s = t.dpr;
			this._revealTop = Math.max(0, t.plotHeight - i.revealHeight);
			const r = this._targetOpacity(), n = this._now(), o = null === this._lastFrameMs ? 0 : Math.max(0, (n - this._lastFrameMs) / 1e3);
			if (this._lastFrameMs = n, i.fadeSeconds <= 0 || o <= 0) i.fadeSeconds <= 0 && (this._opacity = r);
			else {
				const e = o / i.fadeSeconds;
				this._opacity += Math.sign(r - this._opacity) * Math.min(e, Math.abs(r - this._opacity));
			}
			if (this._opacity <= .001) return this._boxes = [], void (this._opacity = 0);
			const a = i.size;
			let l = 0;
			for (let e = 0; e < i.buttons.length; e++) null !== i.buttons[e] ? (l += a, e < i.buttons.length - 1 && null !== i.buttons[e + 1] && (l += i.gap)) : l += i.groupGap;
			const h = (t.plotWidth - l) / 2, c = t.plotHeight - i.bottomMargin - a;
			this._boxes = [];
			let d = h;
			for (let e = 0; e < i.buttons.length; e++) {
				const t = i.buttons[e];
				null !== t ? (this._boxes.push({
					action: t,
					x: d,
					y: c,
					w: a,
					h: a
				}), d += a, e < i.buttons.length - 1 && null !== i.buttons[e + 1] && (d += i.gap)) : d += i.groupGap;
			}
			const u = this._hoveredAction();
			e.save(), e.globalAlpha = this._opacity;
			for (const i of this._boxes) this._button(e, i, i.action === u, t, s);
			i.showTooltip && null !== u && this._tooltip(e, u, t, s), e.restore();
		}
		_hoveredAction() {
			const e = this._pointer;
			if (null === e) return null;
			for (const t of this._boxes) if (e.x >= t.x && e.x <= t.x + t.w && e.y >= t.y && e.y <= t.y + t.h) return t.action;
			return null;
		}
		_button(e, t, i, s, r) {
			const n = this._opts, o = t.x * r, a = t.y * r, l = t.w * r, h = t.h * r, c = Math.min(n.radius * r, l / 2, h / 2);
			e.beginPath(), e.roundRect(o, a, l, h, c), e.fillStyle = so(s.theme.background, s.theme.axisText, i ? .28 : .12), e.fill(), e.strokeStyle = ie(s.theme.axisLine, i ? 1 : .8), e.lineWidth = Math.max(1, Math.round(r)), e.stroke(), e.strokeStyle = s.theme.axisText, e.fillStyle = s.theme.axisText, e.lineWidth = Math.max(1, Math.round(1.5 * r)), e.lineCap = "round", e.lineJoin = "round";
			const d = o + l / 2, u = a + h / 2, _ = .22 * Math.min(l, h);
			switch (e.beginPath(), t.action) {
				case "zoomOut":
					e.moveTo(d - _, u), e.lineTo(d + _, u);
					break;
				case "zoomIn":
					e.moveTo(d - _, u), e.lineTo(d + _, u), e.moveTo(d, u - _), e.lineTo(d, u + _);
					break;
				case "resetScale": {
					const t = _ * Math.SQRT1_2;
					e.arc(d, u, _, .75 * -Math.PI, .75 * Math.PI), e.moveTo(d - t, u - 2 * t), e.lineTo(d - t, u - t), e.lineTo(d, u - t);
					break;
				}
				case "panLeftBar":
					e.moveTo(d + .55 * _, u - _), e.lineTo(d - .5 * _, u), e.lineTo(d + .55 * _, u + _);
					break;
				case "panRightBar": e.moveTo(d - .55 * _, u - _), e.lineTo(d + .5 * _, u), e.lineTo(d - .55 * _, u + _);
			}
			e.stroke();
		}
		_tooltip(e, t, i, s) {
			const r = this._opts, n = this._boxes.find((e) => e.action === t);
			if (void 0 === n) return;
			const o = r.labels[t] ?? eo[t], a = r.hints[t];
			e.font = r.font * s + "px ui-sans-serif, system-ui, sans-serif", e.textBaseline = "middle", e.textAlign = "left";
			const l = 7 * s, h = 8 * s, c = e.measureText(o).width, d = 2 * l + c + (void 0 === a ? 0 : e.measureText(a).width + h + 8 * s), u = 22 * s;
			let _ = (n.x + n.w / 2) * s - d / 2;
			_ = Math.max(2 * s, Math.min(_, i.plotWidth * s - d - 2 * s));
			const p = n.y * s - u - 6 * s;
			if (e.beginPath(), e.roundRect(_, p, d, u, 5 * s), e.fillStyle = so(i.theme.background, i.theme.axisText, .22), e.fill(), e.strokeStyle = ie(i.theme.axisLine, .9), e.lineWidth = Math.max(1, Math.round(s)), e.stroke(), e.fillStyle = i.theme.axisText, e.fillText(o, _ + l, p + u / 2), void 0 !== a) {
				const t = _ + l + c + h, r = e.measureText(a).width + 8 * s;
				e.beginPath(), e.roundRect(t - 4 * s, p + 4 * s, r, u - 8 * s, 3 * s), e.fillStyle = so(i.theme.background, i.theme.axisText, .42), e.fill(), e.fillStyle = i.theme.axisText, e.fillText(a, t, p + u / 2);
			}
		}
		hitTest(e, t) {
			if (this._opacity < .5) return null;
			for (const i of this._boxes) if (e >= i.x && e <= i.x + i.w && t >= i.y && t <= i.y + i.h) return {
				externalId: `${this._opts.id}::${i.action}`,
				zOrder: "top",
				distance: 0,
				cursor: "pointer"
			};
			return null;
		}
	};
	function so(e, t, i) {
		const s = Z(e), r = Z(t);
		if (null === s || null === r) return e;
		const n = i < 0 ? 0 : i > 1 ? 1 : i, o = (e, t) => Math.round(e + (t - e) * n);
		return `rgb(${o(s.r, r.r)},${o(s.g, r.g)},${o(s.b, r.b)})`;
	}
	function ro(e) {
		return void 0 === e ? {
			x: 7,
			y: 4
		} : "number" == typeof e ? {
			x: e,
			y: e
		} : {
			x: e.x,
			y: e.y
		};
	}
	function no(e, t, i, s, r, n) {
		const o = r - t - i, a = n - t - s;
		switch (e) {
			case "top-left": return {
				x: t,
				y: t,
				w: i,
				h: s
			};
			case "top-right": return {
				x: o,
				y: t,
				w: i,
				h: s
			};
			case "bottom-left": return {
				x: t,
				y: a,
				w: i,
				h: s
			};
			case "center": return {
				x: (r - i) / 2,
				y: (n - s) / 2,
				w: i,
				h: s
			};
			default: return {
				x: o,
				y: a,
				w: i,
				h: s
			};
		}
	}
	var oo = class {
		constructor(e = {}) {
			Object.defineProperty(this, "_opts", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_reveal", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_lastFrameMs", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_labelW", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_now", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "undefined" != typeof performance ? () => performance.now() : () => 0
			}), Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_img", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_ready", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_autoHeight", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_tintCanvas", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_tintKey", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: ""
			}), this._autoHeight = void 0 === e.height, this._opts = {
				position: e.position ?? "bottom-right",
				margin: e.margin ?? 12,
				height: e.height ?? 28,
				opacity: e.opacity ?? .7,
				zOrder: e.zOrder ?? "top",
				src: e.src,
				image: e.image,
				tint: e.tint,
				label: e.label,
				id: e.id ?? "watermark",
				revealSeconds: e.revealSeconds ?? .18,
				labelColor: e.labelColor,
				fontSize: e.fontSize ?? 12,
				background: e.background,
				borderColor: e.borderColor,
				radius: e.radius ?? 6,
				padding: ro(e.padding),
				href: e.href,
				utmMedium: e.utmMedium ?? "oac-link",
				utmCampaign: e.utmCampaign ?? "oac-chart"
			}, e.image && (this._img = e.image, this._ready = !0);
		}
		attached(e) {
			if (this._host = e, !this._ready && this._opts.src && "undefined" != typeof Image) {
				const e = new Image();
				e.onload = () => {
					this._img = e, this._ready = !0, this._host?.requestUpdate();
				}, e.decoding = "async", e.src = this._opts.src;
			}
		}
		detached() {
			this._host = null;
		}
		zOrder() {
			return this._opts.zOrder;
		}
		autoscaleInfo() {
			return null;
		}
		setOptions(e) {
			const { padding: t, ...i } = e;
			this._opts = {
				...this._opts,
				...i
			}, void 0 !== t && (this._opts.padding = ro(t)), void 0 !== e.height && (this._autoHeight = !1), void 0 === e.label && void 0 === e.fontSize || (this._labelW = 0), this._tintCanvas = null, e.image ? (this._img = e.image, this._ready = !0) : void 0 !== e.src && (this._ready = !1, this._img = null, this.attached(this._host)), this._host?.requestUpdate();
		}
		_rect(e) {
			if (!(this._builtin() || this._ready && null !== this._img)) return null;
			const t = this._img?.naturalWidth ?? this._img?.width ?? 1, i = this._img?.naturalHeight ?? this._img?.height ?? 1;
			if (!t || !i) return null;
			const s = this._opts, r = Math.max(0, s.margin, s.padding.x, s.padding.y), n = e.plotWidth - 2 * r, o = e.plotHeight - 2 * r;
			if (n <= 0 || o <= 0) return null;
			const a = this._builtin() && this._autoHeight && e.plotWidth < 480 ? 24 : s.height, l = Math.max(0, Math.min(a, o, n * i / t));
			if (!Number.isFinite(l) || l <= 0) return null;
			const h = l * (t / i), c = Math.min(n, h + this._labelW * this._reveal);
			return {
				...no(s.position, r, c, l, e.plotWidth, e.plotHeight),
				logoW: h
			};
		}
		_builtin() {
			return void 0 === this._opts.src && void 0 === this._opts.image;
		}
		href() {
			const e = this._opts.href;
			if (void 0 === e || e.includes("?")) return e;
			const t = "undefined" != typeof location ? location : void 0, i = [`utm_medium=${encodeURIComponent(this._opts.utmMedium)}`, `utm_campaign=${encodeURIComponent(this._opts.utmCampaign)}`];
			return t?.host && i.push(`utm_source=${t.host}${t.pathname}`), `${e}${e.includes("?") ? "&" : "?"}${i.join("&")}`;
		}
		hitTest(e, t, i) {
			if (void 0 === this._opts.label && void 0 === this._opts.href) return null;
			const s = this._rect(i);
			if (null === s) return null;
			const r = Math.max(this._opts.padding.x, 4, (44 - s.w) / 2), n = Math.max(this._opts.padding.y, 4, (44 - s.h) / 2), o = Math.min(i.plotWidth, s.w + 2 * r), a = Math.min(i.plotHeight, s.h + 2 * n), l = Math.max(0, Math.min(i.plotWidth - o, s.x - r)), h = Math.max(0, Math.min(i.plotHeight - a, s.y - n));
			return e >= l && e <= l + o && t >= h && t <= h + a ? {
				externalId: this._opts.id,
				zOrder: this._opts.zOrder,
				distance: 0,
				cursor: void 0 !== this._opts.href ? "pointer" : "default"
			} : null;
		}
		draw(e, t) {
			if (!(this._builtin() || this._ready && null !== this._img)) return;
			const i = this._opts, s = t.dpr;
			void 0 !== i.label && 0 === this._labelW && (e.save(), e.font = `600 ${i.fontSize * s}px system-ui, sans-serif`, this._labelW = e.measureText(i.label).width / s + 8, e.restore()), this._advanceReveal(t);
			const r = this._rect(t);
			if (null === r) return;
			const n = Math.round(r.x * s), o = Math.round(r.y * s), a = Math.round(r.logoW * s), l = Math.round(r.h * s);
			e.save();
			const h = i.padding, c = Math.round((r.x - h.x) * s), d = Math.round((r.y - h.y) * s), u = Math.round((r.x + r.w + h.x) * s) - c, _ = Math.round((r.y + r.h + h.y) * s) - d, p = t.theme, f = i.background ?? (p ? ie(p.background, .82) : "none"), m = i.borderColor ?? p?.axisLine ?? "none";
			"none" !== f && (e.beginPath(), ne(e, c, d, u, _, Math.round(i.radius * s)), e.fillStyle = f, e.fill(), "none" !== m && (e.strokeStyle = m, e.lineWidth = Math.max(1, Math.round(s)), e.stroke())), e.globalAlpha = Math.max(0, Math.min(1, i.opacity));
			const b = this._ink(t), g = void 0 !== i.label ? b : i.tint;
			if (this._builtin()) e.fillStyle = b, function(e, t, i, s) {
				e.save(), e.translate(t, i), e.scale(s / 397, s / 397), e.translate(-315.1, -217.65), e.beginPath(), e.moveTo(367.5, 255.5), e.bezierCurveTo(371.3, 251.3, 374.8, 247.3, 378.7, 242.8), e.bezierCurveTo(398.1, 262.7, 416.4, 281.4, 435.2, 300.6), e.bezierCurveTo(461.6, 273.7, 487.4, 247.4, 513.6, 220.6), e.bezierCurveTo(540.7, 247.4, 566.9, 273.2, 592.9, 298.9), e.bezierCurveTo(611.4, 280.3, 629.8, 262, 648.4, 243.3), e.bezierCurveTo(654.6, 249.9, 660.3, 256.1, 665.9, 262.2), e.bezierCurveTo(648.3, 280.2, 630.3, 298.7, 612.5, 316.9), e.bezierCurveTo(645.6, 350.8, 679, 384.9, 712.1, 418.6), e.bezierCurveTo(684.7, 446.7, 656.7, 475.5, 628.4, 504.5), e.bezierCurveTo(647.5, 523.2, 667.4, 542.7, 686.8, 561.8), e.bezierCurveTo(680.8, 568.3, 675, 574.7, 668.8, 581.5), e.bezierCurveTo(648.3, 561.4, 628.3, 541.7, 608.1, 521.8), e.bezierCurveTo(577.2, 551.9, 546.6, 581.7, 516, 611.7), e.bezierCurveTo(488.3, 584.7, 461, 558, 433.6, 531.3), e.bezierCurveTo(415.9, 548.5, 398.2, 565.6, 380.1, 583.1), e.bezierCurveTo(374.3, 576.6, 368.7, 570.4, 363.5, 564.6), e.bezierCurveTo(379.4, 548, 396.1, 530.5, 412.9, 512.9), e.bezierCurveTo(380.7, 481.9, 348, 450.4, 315.1, 418.7), e.bezierCurveTo(349.2, 385, 383, 351.6, 416.6, 318.3), e.bezierCurveTo(398.1, 299.3, 379.8, 280.6, 360.9, 261.3), e.bezierCurveTo(362.8, 259.7, 365, 257.7, 367.5, 255.5), e.moveTo(540.5, 406), e.bezierCurveTo(552, 417.1, 563.4, 428.1, 575, 439.2), e.bezierCurveTo(588.1, 426.5, 601.7, 413.3, 615.9, 399.5), e.bezierCurveTo(621.9, 406.1, 627.8, 412.6, 633.8, 419.2), e.bezierCurveTo(620.3, 431.7, 606.4, 444.8, 592.9, 457.3), e.bezierCurveTo(600, 464.3, 606.9, 471.2, 613.8, 478.1), e.bezierCurveTo(633.5, 458.1, 653.4, 437.7, 673.2, 417.5), e.bezierCurveTo(620.7, 365.5, 567.7, 313.2, 514.8, 260.8), e.bezierCurveTo(494.6, 280.6, 474.6, 300.2, 454.3, 320), e.bezierCurveTo(461.7, 327, 468.8, 333.8, 477.5, 342.1), e.bezierCurveTo(489.4, 329.1, 501.6, 315.8, 514.3, 301.9), e.bezierCurveTo(521, 308.7, 526.7, 314.6, 531.9, 319.9), e.bezierCurveTo(519.2, 333.3, 506.8, 346.5, 494.7, 359.4), e.bezierCurveTo(509.5, 374.4, 524.7, 390, 540.5, 406), e.moveTo(575.3, 514.8), e.bezierCurveTo(581.4, 508.6, 587.6, 502.3, 593.4, 496.4), e.bezierCurveTo(586.7, 489.5, 580.1, 482.5, 573.2, 475.3), e.bezierCurveTo(557.6, 490.1, 542.3, 504.7, 526.9, 519.3), e.bezierCurveTo(520.9, 513.3, 515.2, 507.5, 509.4, 501.6), e.bezierCurveTo(524.7, 487, 540, 472.3, 555.6, 457.4), e.bezierCurveTo(528.5, 430.5, 501.6, 403.8, 474.5, 377), e.bezierCurveTo(461.3, 389.6, 448, 402.3, 434.6, 415.2), e.bezierCurveTo(455, 435.2, 475.1, 454.9, 494.9, 474.3), e.bezierCurveTo(482.1, 487.6, 469.4, 500.8, 456.5, 514.1), e.bezierCurveTo(476.3, 533.2, 496.5, 552.7, 516.8, 572.4), e.bezierCurveTo(536.3, 553.1, 555.6, 534.2, 575.3, 514.8), e.moveTo(413.2, 474.3), e.bezierCurveTo(420.1, 481, 427, 487.7, 434.6, 495.1), e.bezierCurveTo(441.3, 487.6, 447.8, 480.3, 453.9, 473.5), e.bezierCurveTo(435.5, 454.7, 416.3, 435.1, 397.1, 415.5), e.bezierCurveTo(416.9, 396.5, 436.7, 377.7, 456.9, 358.4), e.bezierCurveTo(449.8, 351.8, 442.7, 345.3, 435.6, 338.7), e.bezierCurveTo(409, 364.8, 381.8, 391.4, 354.7, 418), e.bezierCurveTo(374.3, 436.9, 393.4, 455.4, 413.2, 474.3), e.closePath(), e.fill(), e.restore();
			}(e, n, o, l);
			else {
				const t = g ? this._tinted(e, a, l, g) : this._img;
				g && t ? e.drawImage(t, n, o) : this._img && e.drawImage(this._img, n, o, a, l);
			}
			if (void 0 !== i.label && this._reveal > .001) {
				const t = (r.w - r.logoW) * s;
				e.beginPath(), e.rect(n + a, o, t, l), e.clip(), e.globalAlpha = this._reveal, e.font = `600 ${Math.round(i.fontSize * s)}px system-ui, -apple-system, sans-serif`, e.textBaseline = "middle", e.textAlign = "left", e.fillStyle = b, e.fillText(i.label, Math.round(n + a + 6 * s), Math.round(o + l / 2));
			}
			e.restore();
		}
		_ink(e) {
			const t = this._opts, i = e.theme;
			return t.labelColor ?? t.tint ?? i?.axisText ?? "#9aa3b2";
		}
		_advanceReveal(e) {
			if (void 0 === this._opts.label) return;
			const t = e.hoverId === this._opts.id ? 1 : 0, i = this._now(), s = null === this._lastFrameMs ? 0 : Math.max(0, (i - this._lastFrameMs) / 1e3);
			this._lastFrameMs = i;
			const r = this._opts.revealSeconds;
			if (r <= 0) this._reveal = t;
			else if (this._reveal !== t) {
				const e = s / r;
				this._reveal += Math.sign(t - this._reveal) * Math.min(e, Math.abs(t - this._reveal));
			}
			Math.abs(t - this._reveal) > .001 ? this._host?.requestUpdate() : this._reveal = t;
		}
		_tinted(e, t, i, s) {
			const r = `${t}x${i}:${s}`;
			if (this._tintCanvas && this._tintKey === r) return this._tintCanvas;
			const o = e.canvas?.ownerDocument;
			let a = null;
			if (o && "function" == typeof o.createElement && (a = o.createElement("canvas")), !a) return null;
			a.width = t, a.height = i;
			const l = a.getContext("2d");
			return l && null !== this._img ? (l.clearRect(0, 0, t, i), l.drawImage(this._img, 0, 0, t, i), l.globalCompositeOperation = "source-in", l.fillStyle = s, l.fillRect(0, 0, t, i), this._tintCanvas = a, this._tintKey = r, a) : null;
		}
	};
	function lo(e) {
		if (!ts(e)) throw new Error("Invalid pane scale object");
		if (!is(e)) throw new Error("Pane scale accessors are not supported");
		return e;
	}
	function ho(e, t, i = -Number.MAX_VALUE, s = Number.MAX_VALUE) {
		if ("number" != typeof e || !Number.isFinite(e) || e < i || e > s) throw new Error(`Invalid ${t}`);
		return e;
	}
	function co(e) {
		const t = lo(e), i = ho(t.min, "scale range minimum");
		return {
			min: i,
			max: ho(t.max, "scale range maximum", i)
		};
	}
	function uo(e, t) {
		const i = lo(e), s = (e, s) => void 0 === i[e] && t ? s : i[e], r = s("mode", "linear"), n = s("inverted", !1), o = s("autoScale", !0);
		if (!m.includes(r) || "boolean" != typeof n || "boolean" != typeof o) throw new Error("Invalid price scale mode or flags");
		const a = {
			marginTop: ho(s("marginTop", .1), "top scale margin"),
			marginBottom: ho(s("marginBottom", .1), "bottom scale margin"),
			minMove: ho(s("minMove", 0), "scale tick", 0),
			mode: r,
			inverted: n,
			autoScale: o
		};
		if (void 0 !== i.minPrecision && (a.minPrecision = ho(i.minPrecision, "scale precision", 0, 100), !Number.isInteger(a.minPrecision))) throw new Error("Scale precision must be an integer");
		if (void 0 !== i.range && (a.range = co(i.range)), void 0 !== i.fixedRange && (a.fixedRange = null === i.fixedRange ? null : co(i.fixedRange)), void 0 !== i.indicatorRange) {
			const e = lo(i.indicatorRange);
			if ("string" != typeof e.instanceId || !e.instanceId.trim() || "boolean" != typeof e.manual || !a.fixedRange) throw new Error("Invalid indicator range ownership");
			a.indicatorRange = {
				instanceId: e.instanceId,
				manual: e.manual
			};
		}
		if (void 0 !== i.ratioLock) {
			const e = lo(i.ratioLock);
			if (o || !a.range) throw new Error("A scale ratio lock requires a manual range");
			a.ratioLock = {
				barSpacing: ho(e.barSpacing, "ratio bar spacing", Number.MIN_VALUE),
				height: ho(e.height, "ratio height", Number.MIN_VALUE)
			};
		}
		if (void 0 !== i.placement) {
			const e = lo(i.placement);
			if (!Object.prototype.hasOwnProperty.call(e, "side") || !Object.prototype.hasOwnProperty.call(e, "order") || ![
				"left",
				"right",
				"hidden"
			].includes(e.side) || "number" != typeof e.order || !Number.isSafeInteger(e.order) || e.order < 0) throw new Error("Invalid price axis placement side or order");
			a.placement = {
				side: e.side,
				order: e.order
			};
		}
		return a;
	}
	function _o(e, t = !1) {
		const i = lo(e), s = {
			weight: ho(i.weight, "pane weight", Number.MIN_VALUE),
			priceScale: uo(i.priceScale, t)
		};
		if (void 0 !== i.scales) {
			const e = lo(i.scales);
			s.scales = {};
			for (const [t, i] of Object.entries(e)) {
				if (!L(t) || "right" === t) throw new Error("Invalid secondary price scale id");
				s.scales[t] = uo(i, !1);
			}
		}
		if (void 0 !== i.collapsed) {
			if ("boolean" != typeof i.collapsed) throw new Error("Invalid pane collapse flag");
			s.collapsed = i.collapsed;
		}
		return s;
	}
	var po = class {
		constructor(e) {
			Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_restoreGeneration", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), this._host = e;
		}
		getState() {
			const e = Ts(this._host._indicators.map((e) => e.dependencyNode())).dependencies, t = this._host._panes.map((e) => {
				const t = e.scaleStates();
				for (const [i, s] of this._host._indicatorRanges) {
					if (s.pane !== e) continue;
					const r = e.scaleFor(s.scaleId), n = this._host._ownedScaleRanges.get(r), o = n ? r.ownedFixedRangeState(n) : null;
					o && t[s.scaleId] && !t[s.scaleId].indicatorRange && (t[s.scaleId].indicatorRange = {
						instanceId: i,
						manual: o.manual
					});
				}
				const { right: i, ...s } = t, r = {
					weight: e.weight,
					priceScale: i
				};
				return Object.keys(s).length && (r.scales = s), this._host._collapsed.has(e) && (r.collapsed = !0), r;
			}), i = [];
			this._host._panes.forEach((e, t) => {
				for (const s of e.series()) {
					const e = Object.fromEntries(Object.entries(s.style).filter(([, e]) => void 0 !== e)), r = this._host._series._transformOf(s.dataId);
					i.push({
						type: s.type,
						style: e,
						paneIndex: t,
						priceScaleId: s.scaleId,
						...void 0 === r ? {} : { transform: r }
					});
				}
			});
			const s = this._host._primaryIndex(), r = {
				version: s > 0 ? 2 : 1,
				timezone: this._host._timezone,
				viewport: { ...this._host.getVisibleLogicalRange() },
				barSpacing: this._host._timeScale.barSpacing,
				navigation: this._host.navigationOptions(),
				grid: this._host.gridOptions(),
				canvas: this._host.canvasOptions(),
				statusLine: this._host.statusLineOptions(),
				watermark: this._host.watermarkOptions(),
				trading: { ...this._host._tradingSettings },
				axisChrome: {
					sessionClock: this._host._axisChrome.sessionClock,
					barCountdown: this._host._axisChrome.barCountdown
				},
				events: this._host.eventOptions(),
				crosshairMode: this._host._crosshairMode,
				crosshairSnapToBar: this._host._crosshairSnapToBar,
				priceOnlyAutoScale: this._host._priceOnlyAutoScale,
				indicatorLegendCollapsed: this._host._indicatorLegendCollapsed,
				panes: t,
				...s > 0 ? { primaryPane: s } : {},
				series: i,
				indicators: this._host._indicators.map((t) => ({
					indicatorId: t.indicatorId,
					instanceId: t.id,
					settings: t.settings(),
					paneIndex: t.paneIndex,
					visible: t.visible(),
					...e.get(t.id)?.length ? { studyInputs: e.get(t.id).map((e) => e.inputKey) } : {},
					...null === t.priceScaleId() ? {} : { priceScaleId: t.priceScaleId() },
					...Object.keys(t.plotPriceScaleIds()).length ? { plotPriceScaleIds: t.plotPriceScaleIds() } : {},
					...Object.keys(t.policy()).length ? { policy: { ...t.policy() } } : {},
					..."underlying" === t.barSource() ? { barSource: "underlying" } : {}
				})),
				..."string" == typeof this._host._sourceAbove ? { sourceAbove: this._host._sourceAbove } : {}
			};
			return void 0 !== this._host._drawingState && (r.drawings = this._host._drawingState), void 0 !== this._host._alertState && (r.alerts = fn(this._host._alertState)), r;
		}
		restoreState(e, t = {}) {
			const s = e;
			if (null === s || "object" != typeof s || "number" != typeof s.version) return {
				applied: !1,
				series: [],
				indicators: 0,
				reason: "not a chart state object"
			};
			if (s.version > 2) return {
				applied: !1,
				series: [],
				indicators: 0,
				reason: `state version ${s.version} is newer than 2`
			};
			let r, n, o, a;
			const l = /* @__PURE__ */ new Map(), h = /* @__PURE__ */ new Set();
			try {
				const e = Object.getOwnPropertyDescriptor(s, "priceOnlyAutoScale");
				if (e && (!("value" in e) || void 0 !== e.value && "boolean" != typeof e.value)) throw new Error("Invalid price-only autoscale preference");
				const i = Object.getOwnPropertyDescriptor(s, "indicatorLegendCollapsed");
				if (i && (!("value" in i) || void 0 !== i.value && "boolean" != typeof i.value)) throw new Error("Invalid indicator legend preference");
				const c = (e) => ts(e) && is(e);
				if (!c(t)) throw new Error("Invalid chart restore options");
				if (void 0 !== t.preserveScaleFormats) {
					const e = t.preserveScaleFormats;
					if (!Array.isArray(e)) throw new Error("Invalid preserved scale formats");
					const i = Object.getOwnPropertyDescriptors(e);
					if (Reflect.ownKeys(i).some((t) => "length" !== t && ("string" != typeof t || !/^(0|[1-9]\d*)$/.test(t) || Number(t) >= e.length || !("value" in i[t])))) throw new Error("Invalid preserved scale formats");
					for (let t = 0; t < e.length; t++) {
						const e = i[t]?.value;
						if (!c(e) || "number" != typeof e.paneIndex || !Number.isInteger(e.paneIndex) || e.paneIndex < 0 || !L(e.scaleId)) throw new Error("Invalid preserved scale selector");
						const s = this._host._panes[e.paneIndex];
						if (!s || !Object.prototype.hasOwnProperty.call(s.scaleStates(), e.scaleId)) throw new Error("Preserved scale must already exist");
						const r = l.get(s) ?? /* @__PURE__ */ new Set();
						r.add(e.scaleId), l.set(s, r);
					}
				}
				if (void 0 !== s.panes) {
					if (!Array.isArray(s.panes)) throw new Error("Invalid pane list");
					n = s.panes.map((e) => _o(e, !0));
				}
				const d = Object.getOwnPropertyDescriptor(s, "primaryPane");
				if (d && (!("value" in d) || void 0 !== d.value)) {
					const e = d.value;
					if ("number" != typeof e || !Number.isSafeInteger(e) || e < 0 || !(e < (n?.length ?? 0))) throw new Error("Invalid primary pane slot");
					if (s.version < 2) throw new Error("A moved price pane needs chart version 2");
					if (e > 0 && !this._host._movablePrimaryPane) throw new Error("A moved price pane needs movablePrimaryPane");
					o = e;
				}
				if (void 0 !== s.alerts && (r = fn(s.alerts)), void 0 !== s.sourceAbove && ("string" != typeof s.sourceAbove || !s.sourceAbove.trim())) throw new Error("Invalid source placement");
				if (void 0 !== s.indicators) {
					if (!Array.isArray(s.indicators)) throw new Error("Invalid indicator list");
					for (const e of s.indicators) {
						if ("plotPriceScaleIds" in e) {
							const t = Object.getOwnPropertyDescriptor(e, "plotPriceScaleIds");
							if (!t?.enumerable || !("value" in t)) throw new Error("Invalid indicator plot price scale map field");
						}
						if (void 0 !== e.priceScaleId && !L(e.priceScaleId)) throw new Error("Invalid indicator price scale");
						if (void 0 !== e.barSource && dr(e.barSource), void 0 !== e.instanceId) {
							if ("string" != typeof e.instanceId || !e.instanceId.trim() || h.has(e.instanceId)) throw new Error("Invalid or duplicate indicator instance id");
							h.add(e.instanceId);
						}
					}
					this._host._reserveAlertStudyIds(r, h);
					const e = /* @__PURE__ */ new Set([
						...h,
						...this._host._indicatorReservedIds,
						...this._host._indicators.map((e) => e.id)
					]), t = s.indicators.map((e) => ({
						...e,
						settings: ks(e.settings ?? {}),
						...void 0 === e.policy ? {} : { policy: js(e.policy) }
					}));
					for (const i of t) for (const t of Object.values(i.settings)) t && "object" == typeof t && "kind" in t && "indicator" === t.kind && "instanceId" in t && "string" == typeof t.instanceId && (e.add(t.instanceId), h.add(t.instanceId));
					let i = 0;
					for (const s of t) {
						if (void 0 === s.instanceId) {
							do
								s.instanceId = "restored-study-" + ++i;
							while (e.has(s.instanceId));
							e.add(s.instanceId);
						}
						h.add(s.instanceId);
					}
					const l = new Map(t.filter((e) => us(e.indicatorId)).map((e) => [e.instanceId, ds(e.indicatorId)]));
					a = {
						specs: t,
						order: Ts(t.flatMap((e) => {
							const t = l.get(e.instanceId);
							return t && void 0 !== e.plotPriceScaleIds && (e.plotPriceScaleIds = Br(t, e.plotPriceScaleIds)), t && (ss(t.inputs, e.settings), qr(t, e.priceScaleId, e.plotPriceScaleIds, e.paneIndex, void 0 === n ? this._host._primaryIndex() : o ?? 0)), t ? [{
								id: e.instanceId,
								descriptor: t,
								settings: e.settings
							}] : [];
						})).order,
						descriptors: l
					};
				}
			} catch (e) {
				return {
					applied: !1,
					series: [],
					indicators: 0,
					reason: e instanceof Error ? e.message : "Invalid saved alerts or identities"
				};
			}
			this._host._reserveAlertStudyIds(r, h);
			for (const e of h) this._host._indicatorReservedIds.add(e);
			const c = ++this._restoreGeneration, d = this._host._priceOnlyAutoScale, u = this._host._indicatorLegendCollapsed;
			this._host._emit("state:restore:start", {});
			const _ = this._host._timeScale.visibleRange();
			try {
				if (c !== this._restoreGeneration) return {
					applied: !1,
					series: [],
					indicators: 0,
					reason: "superseded by a newer chart restore"
				};
				const e = this._host._withinLayoutChange(() => this._host._mutateTimeScale(() => this._restoreState(s, r, h, n, o ?? 0, a, l)));
				return !e.applied || c !== this._restoreGeneration || d === this._host._priceOnlyAutoScale && u === this._host._indicatorLegendCollapsed || this._host._emit("objects:change", {}), e;
			} finally {
				l.clear(), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._emitViewportIfMoved(_), this._host._emit("state:restore:end", {});
			}
		}
		_restoreState(e, t, s, r, n, o, a) {
			if (r) for (const e of this._host._panes) e.clearRatioLocks();
			e.grid && this._host.setGridOptions(e.grid), e.canvas && this._host.setCanvasOptions(e.canvas), e.statusLine && this._host.setStatusLineOptions(e.statusLine), e.watermark && this._host.setWatermarkOptions(e.watermark), e.trading && this._host.setTradingSettings(e.trading), e.axisChrome && this._host.setAxisChromeOptions(e.axisChrome), e.navigation && "object" == typeof e.navigation && this._host._input._patchNavigation(e.navigation), e.events && this._host.setEventOptions(e.events), e.crosshairMode && (this._host._crosshairMode = e.crosshairMode), "boolean" == typeof e.crosshairSnapToBar && (this._host._crosshairSnapToBar = e.crosshairSnapToBar);
			const l = Object.getOwnPropertyDescriptor(e, "priceOnlyAutoScale");
			l && "boolean" == typeof l.value && (this._host._priceOnlyAutoScale = l.value);
			const h = Object.getOwnPropertyDescriptor(e, "indicatorLegendCollapsed");
			if (h && "boolean" == typeof h.value && (this._host._indicatorLegendCollapsed = h.value), this._host._legendStack._restackLegends(), "string" == typeof e.timezone && _t(e.timezone) && this._host.setTimezone(e.timezone), r) {
				for (let e = 0; e < r.length; e++) this._host._layout._ensurePane(e);
				this._host.setPrimaryPaneIndex(n), r.forEach((e, t) => {
					this._host._panes[t].weight = e.weight;
				});
			}
			(r || o) && (this._host._panes.forEach((e, t) => {
				e !== this._host._primaryPane && r?.[t]?.collapsed ? this._host._collapsed.add(e) : this._host._collapsed.delete(e);
			}), this._host._layout._relayout(), this._host._primitives._rehomeAnchored());
			let c = 0;
			if (o) {
				this._host._indicatorRefreshes.clear();
				for (const e of this._host._indicators.splice(0)) e.remove({ force: !0 });
				const t = new Map(o.specs.map((e) => [e.instanceId, e]));
				for (const e of o.order) {
					const i = t.get(e), r = o.descriptors.get(e), n = new Xr(this._host._indicatorHost(a), r, i.settings, i.paneIndex, i.instanceId, s, i.priceScaleId, i.plotPriceScaleIds, i.policy, i.barSource, !0);
					s.add(n.id), this._host._indicators.push(n), !1 === i.visible && n.setVisible(!1), c += 1;
				}
				const i = new Map(o.specs.map((e, t) => [e.instanceId, t]));
				this._host._indicators.sort((e, t) => i.get(e.id) - i.get(t.id)), this._host._sourceAbove = e.sourceAbove, this._host._studies._reorderIndicatorResources();
			}
			const d = [];
			r && r.forEach((e, t) => {
				const i = this._host._panes[t];
				if (void 0 === i) return;
				const s = [["right", e.priceScale], ...Object.entries(e.scales ?? {})];
				i.restoreAxisPlacements(new Map(s.flatMap(([e, t]) => t.placement ? [[e, t.placement]] : [])));
				for (const [e, t] of s) {
					const s = i.scaleFor(e), r = {
						marginTop: t.marginTop,
						marginBottom: t.marginBottom,
						minMove: t.minMove,
						mode: t.mode,
						inverted: t.inverted
					};
					void 0 !== t.minPrecision && (r.minPrecision = t.minPrecision), s.setOptions("right" === e && void 0 === t.minPrecision ? this._host._scales._scalePatchFor(i, r) : r);
					const n = t.indicatorRange ? this._host._indicatorRanges.get(t.indicatorRange.instanceId) : void 0;
					n && n.pane === i && n.scaleId === e && t.fixedRange?.min === n.range.min && t.fixedRange?.max === n.range.max ? (s.ownsFixedRange(n.token) || (s.setFixedRange(null), s.setAutoScale(!0), s.setOwnedFixedRange(n.token, n.range), this._host._ownedScaleRanges.set(s, n.token)), s.setAutoScale(!0), t.indicatorRange.manual && (s.setAutoScale(!1), t.range && s.setPriceRange(t.range))) : (void 0 !== t.fixedRange && s.setFixedRange(t.fixedRange), s.setAutoScale(t.autoScale), !t.autoScale && t.range && s.setPriceRange(t.range)), t.ratioLock && d.push({
						pane: i,
						id: e,
						reference: t.ratioLock
					});
				}
			}), this._host._drawingState = e.drawings, this._host._emit("drawings:restore", e.drawings ?? []);
			for (let e = this._host._panes.length - 1; e >= 0; e--) {
				const t = this._host._panes[e];
				!this._host._indicators.some((t) => t.paneIndex === e) && this._host._layout._holdsOnlyFurniture(t) && this._host.removePane(e);
			}
			this._host._alertState = t, this._host._layout._recomputeAxisColumns(), void 0 !== e.barSpacing && this._host._timeScale.setBarSpacing(e.barSpacing), e.viewport && this._host._dataLayer.length > 0 && this._host.setVisibleLogicalRange(e.viewport);
			for (const { pane: e, id: t, reference: i } of d) this._host._panes.includes(e) && e.setRatioLock(t, !0, i.barSpacing, i.height);
			return this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._emit("alerts:restore", t ?? {
				version: 1,
				alerts: []
			}), this._host._emit("objects:change", {}), {
				applied: !0,
				series: e.series ?? [],
				indicators: c
			};
		}
	};
	var fo = /* @__PURE__ */ new WeakMap();
	var mo = /* @__PURE__ */ new WeakMap();
	function bo(e) {
		return fo.get(e);
	}
	function yo(e, t) {
		let i = mo.get(e);
		return i || (i = /* @__PURE__ */ new Set(), mo.set(e, i)), i.add(t), () => {
			i.delete(t), i.size || mo.delete(e);
		};
	}
	var wo = {
		position: "bottom-right",
		margin: 8,
		cellWidth: 64,
		cellHeight: 18,
		fontSize: 11,
		borderWidth: 1
	};
	function xo(e, t, i) {
		const s = Math.floor(.62 * e);
		return 1 === t ? s : Math.max(0, Math.min(s, Math.floor((e - 2 * Math.round(4 * i)) / (1.2 * t))));
	}
	function So(e, t, i, s) {
		return Math.min(Math.round(e * i), xo(t, s, i));
	}
	function Po(e, t) {
		return `${!0 === e.italic ? "italic " : ""}${!0 === e.bold ? "600 " : ""}${t}px ${e.fontFamily ?? "system-ui, sans-serif"}`;
	}
	function Oo(e) {
		return e.text.split(/\r\n|\r|\n/);
	}
	function ko(e, t) {
		let i = 0;
		for (const s of t) i = Math.max(i, e.measureText(s).width);
		return i;
	}
	function Io(e, t, i, s, r, n, o) {
		const a = (e) => Math.round(e * o), l = xo(s, i.length, o);
		let h;
		if (void 0 === t.fontSize && "auto" === n.fontSize) {
			const s = 1 === i.length, n = s ? a(6) : Math.min(a(6), l);
			h = s ? Math.max(n, l) : l, e.font = Po(t, h);
			const o = s ? Math.max(1, a(1)) : 1;
			for (; h > n && ko(e, i) > r;) h = s ? h - o : Math.max(n, h - o), e.font = Po(t, h);
		} else h = So(t.fontSize ?? ("auto" === n.fontSize ? 11 : n.fontSize), s, o, i.length);
		return h;
	}
	var Mo = 28;
	function To(e, t, i, s, r, n) {
		const [o, a] = e.split("-");
		return {
			x: "left" === a ? t : "right" === a ? r - i - t : (r - i) / 2,
			y: "top" === o ? t : "bottom" === o ? n - s - t : (n - s) / 2
		};
	}
	var Co = 0;
	var jo = class {
		constructor(e = {}) {
			Object.defineProperty(this, "_rows", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_grid", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: {
					cols: 0,
					cells: []
				}
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
			}), Object.defineProperty(this, "_rect", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_hitId", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "table-tooltip:" + ++Co
			}), Object.defineProperty(this, "_revision", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_hits", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_size", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), this._opts = {
				...wo,
				...e
			};
		}
		attached(e) {
			this._host = e;
		}
		detached() {
			this._host = null, this._clearHits();
		}
		zOrder() {
			return "top";
		}
		options() {
			return this._opts;
		}
		setOptions(e) {
			this._opts = {
				...this._opts,
				...e
			}, this._clearHits(), this._host?.requestUpdate();
		}
		setRows(e) {
			const t = function(e) {
				let t = 0;
				for (const i of e) t = Math.max(t, i.length);
				const i = /* @__PURE__ */ new Map(), s = [];
				for (let r = 0; r < e.length; r++) for (let n = 0; n < e[r].length; n++) {
					const o = e[r][n];
					if (void 0 !== o.tooltip && "string" != typeof o.tooltip) throw new TypeError("Table tooltip must be text");
					const a = void 0 === o.rowSpan ? 1 : o.rowSpan, l = void 0 === o.colSpan ? 1 : o.colSpan;
					if (!Number.isSafeInteger(a) || a < 1 || !Number.isSafeInteger(l) || l < 1) throw new RangeError("Table spans must be positive safe integers");
					if (a > e.length - r || l > t - n) throw new RangeError("Table span exceeds the grid bounds");
					if (a > 1 || l > 1) for (let e = r; e < r + a; e++) {
						let t = i.get(e);
						if (void 0 === t && (t = [], i.set(e, t)), t.some((e) => n < e.to && e.from < n + l)) throw new RangeError("Table spans overlap");
						t.push({
							from: n,
							to: n + l
						});
					}
					else if (i.get(r)?.some((e) => e.from <= n && n < e.to)) continue;
					s.push({
						cell: o,
						row: r,
						col: n,
						rowSpan: a,
						colSpan: l
					});
				}
				return {
					cols: t,
					cells: s
				};
			}(e);
			this._rows = e, this._grid = t, this._clearHits(), this._host?.requestUpdate();
		}
		rows() {
			return this._rows;
		}
		_clearHits() {
			this._rect = null, this._hits = [], this._size = null, this._revision++;
		}
		_sameSize(e) {
			return this._size?.width === e.plotWidth && this._size.height === e.plotHeight && this._size.dpr === e.dpr;
		}
		draw(e, t) {
			this._sameSize(t) || this._clearHits(), this._size = {
				width: t.plotWidth,
				height: t.plotHeight,
				dpr: t.dpr
			}, this._rect = null, this._hits = [];
			const i = this._rows;
			if (0 === i.length) return;
			const s = this._opts, r = t.dpr, { cols: n, cells: o } = this._grid;
			if (0 === n) return;
			const a = i.map((e, t) => {
				const i = s.rowWeights?.[t];
				return "number" == typeof i && i > 0 ? i : 1;
			}), l = a.reduce((e, t) => e + t, 0);
			let h = s.cellHeight, c = h * l;
			void 0 !== s.heightPercent && s.heightPercent > 0 && (c = t.plotHeight * s.heightPercent / 100, h = c / l);
			const d = [];
			for (let e = 0, t = 0; e < i.length; e++) d.push(t), t += h * a[e];
			const u = a.map((e) => Math.round(h * e * r)), _ = o.map((e) => 1 === e.rowSpan ? u[e.row] : Math.round((d[e.row + e.rowSpan] ?? c) * r) - Math.round(d[e.row] * r));
			e.save();
			const p = function(e, t) {
				const i = [];
				let s = 0;
				for (let r = 0; r < t; r++) i.push(s), s += "number" == typeof e ? e : e[r] ?? e[e.length - 1] ?? 0;
				return {
					x: i,
					total: s
				};
			}("auto" === s.cellWidth ? function(e, t, i, s, r, n) {
				const o = Array(i).fill(Mo), a = ({ cell: t }, i) => {
					if ("" === t.text) return 0;
					const s = Oo(t), o = t.fontSize ?? r.fontSize, a = "auto" === o ? Math.round(11 * n) : So(o, i, n, s.length);
					return a <= 0 ? 0 : (e.font = Po(t, a), ko(e, s) / n + 10);
				};
				for (let e = 0; e < t.length; e++) {
					const i = t[e];
					1 === i.colSpan && (o[i.col] = Math.max(o[i.col], a(i, s[e])));
				}
				for (let e = 0; e < t.length; e++) {
					const i = t[e];
					if (1 === i.colSpan) continue;
					let r = 0;
					for (let e = i.col; e < i.col + i.colSpan; e++) r += o[e];
					const n = Math.max(0, a(i, s[e]) - r) / i.colSpan;
					for (let e = i.col; e < i.col + i.colSpan; e++) o[e] += n;
				}
				return o;
			}(e, o, n, _, s, r) : s.cellWidth, n);
			let f = p.x, m = p.total;
			if (void 0 !== s.widthPercent && s.widthPercent > 0 && m > 0) {
				const e = t.plotWidth * s.widthPercent / 100, i = e / m;
				f = f.map((e) => e * i), m = e;
			}
			const b = To(s.position, s.margin, m, c, t.plotWidth, t.plotHeight);
			this._rect = {
				x: b.x,
				y: b.y,
				w: m,
				h: c
			};
			const g = (e) => Math.round(e * r), v = g(b.x), y = g(b.y);
			void 0 !== s.background && (e.fillStyle = s.background, e.fillRect(v, y, g(m), g(c))), e.textBaseline = "middle";
			for (let i = 0; i < o.length; i++) {
				const { cell: n, row: a, col: l, colSpan: h } = o[i], c = y + g(d[a]), u = _[i], p = v + g(f[l]), b = f[l + h] ?? m, w = 1 === h ? g(b - f[l]) : g(b) - g(f[l]);
				if (n.tooltip) {
					const e = Math.max(0, p / r), i = Math.max(0, c / r), s = Math.min(t.plotWidth, (p + w) / r), o = Math.min(t.plotHeight, (c + u) / r);
					s > e && o > i && this._hits.push({
						x: e,
						y: i,
						w: s - e,
						h: o - i,
						key: `${this._hitId}:${this._revision}:${a}:${l}`,
						tooltip: n.tooltip
					});
				}
				if (void 0 !== n.bgColor && (e.fillStyle = n.bgColor, e.fillRect(p, c, w, u)), void 0 !== s.borderColor && s.borderWidth > 0 && (e.strokeStyle = s.borderColor, e.lineWidth = Math.max(1, g(s.borderWidth)), e.strokeRect(p, c, w, u)), "" === n.text) continue;
				const x = g(4);
				e.save(), e.beginPath(), e.rect(p, c, w, u), e.clip();
				const S = Oo(n), P = Io(e, n, S, u, w - 2 * x, s, r);
				if (P <= 0) {
					e.restore();
					continue;
				}
				e.font = Po(n, P), e.fillStyle = n.textColor ?? (void 0 !== n.bgColor ? Q(n.bgColor) : t.theme.axisText);
				const O = n.align ?? "center";
				e.textAlign = O;
				const k = "left" === O ? p + x : "right" === O ? p + w - x : p + w / 2, I = 1.2 * P, M = S.length * I, T = Math.min(x, Math.max(0, (u - M) / 2)), C = "top" === n.verticalAlign ? c + T + I / 2 : "bottom" === n.verticalAlign ? c + u - T - M + I / 2 : c + u / 2 - (S.length - 1) * I / 2;
				for (let t = 0; t < S.length; t++) e.fillText(S[t], k, C + t * I);
				e.restore();
			}
			void 0 !== s.frameColor && (s.frameWidth ?? 1) > 0 && (e.strokeStyle = s.frameColor, e.lineWidth = Math.max(1, g(s.frameWidth ?? 1)), e.strokeRect(v, y, g(m), g(c))), this._drawTooltip(e, t), e.restore();
		}
		_drawTooltip(e, t) {
			if (t.hoverId !== (this._opts.id ?? this._hitId) || !t.hoverKey) return;
			const i = this._hits.find((e) => e.key === t.hoverKey), s = t.dpr, r = t.plotWidth * s, n = t.plotHeight * s;
			if (!i || r <= 10 * s || n <= 6 * s) return;
			e.save(), e.font = 11 * s + "px system-ui, sans-serif", e.textAlign = "left", e.textBaseline = "middle";
			const o = 5 * s, a = 3 * s, l = 11 * s * 1.35, h = function(e, t, i, s) {
				const r = [];
				for (const n of t.split(/\r\n|\r|\n/)) {
					const t = Array.from(n);
					0 === t.length && r.push("");
					for (let n = 0; n < t.length && r.length < s;) {
						let s = 0, o = t.length - n;
						for (; s < o;) {
							const r = Math.ceil((s + o) / 2);
							e.measureText(t.slice(n, n + r).join("")).width <= i ? s = r : o = r - 1;
						}
						let a = Math.max(1, s);
						if (n + a < t.length) {
							for (let e = a - 1; e > 0; e--) if (/\s/.test(t[n + e])) {
								a = e + 1;
								break;
							}
						}
						r.push(t.slice(n, n + a).join("")), n += a;
					}
					if (r.length >= s) break;
				}
				return r;
			}(e, i.tooltip, r - 2 * o, Math.ceil((n - 2 * a) / l)), c = Math.min(r, ko(e, h) + 2 * o), d = h.length * l + 2 * a, u = Math.max(0, Math.min((i.x + i.w / 2) * s - c / 2, r - c)), _ = i.y * s - 8 * s - d, p = Math.max(0, Math.min(_ >= 0 ? _ : (i.y + i.h) * s + 8 * s, n - d));
			e.beginPath(), e.rect(0, 0, r, n), e.clip(), e.beginPath(), ne(e, u, p, c, d, Math.min(3 * s, c / 2, d / 2)), e.fillStyle = t.theme.axisText, e.fill(), e.fillStyle = Q(t.theme.axisText);
			for (let t = 0; t < h.length; t++) e.fillText(h[t], u + o, p + a + (t + .5) * l);
			e.restore();
		}
		hitTest(e, t, i) {
			if (void 0 !== i && !this._sameSize(i)) return this._clearHits(), null;
			if (!Number.isFinite(e) || !Number.isFinite(t) || !this._size || e < 0 || t < 0 || e > this._size.width || t > this._size.height) return null;
			const s = this._rect;
			if (null === s) return null;
			for (const i of this._hits) if (e >= i.x && e < i.x + i.w && t >= i.y && t < i.y + i.h) return {
				externalId: this._opts.id ?? this._hitId,
				hoverKey: i.key,
				zOrder: "top",
				distance: 0,
				cursor: "default"
			};
			return void 0 === this._opts.id || e < s.x || e > s.x + s.w || t < s.y || t > s.y + s.h ? null : {
				externalId: this._opts.id,
				zOrder: "top",
				distance: 0,
				cursor: "default"
			};
		}
	};
	var Ao = [
		"#f5a623",
		"#26a69a",
		"#ab47bc",
		"#ef5350",
		"#26c6da",
		"#8bc34a",
		"#ff7043",
		"#5c6bc0"
	];
	var Lo = class {
		constructor(e, t) {
			Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_chart", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_recomputing", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_indicatorWork", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_indicatorProcessed", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_barColorOwner", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_barColors", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_barColorBase", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_barColorAnchor", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), this._chart = e, this._host = t;
		}
		addIndicator(e, t, i) {
			const s = i.instanceId;
			if (void 0 !== s && ("string" != typeof s || !s.trim())) throw new TypeError("Invalid indicator instance id");
			if (void 0 !== s && this._host._indicators.some((e) => e.id === s)) throw new Error(`Indicator instance id already in use: ${s}`);
			if (void 0 !== i.priceScaleId && !L(i.priceScaleId)) throw new TypeError("Invalid indicator price scale");
			const r = void 0 === i.policy ? void 0 : js(i.policy), n = void 0 === i.barSource ? void 0 : dr(i.barSource), o = ds(e), a = ks(t);
			ss(o.inputs, a);
			const l = void 0 === i.plotPriceScaleIds ? void 0 : Br(o, i.plotPriceScaleIds);
			qr(o, i.priceScaleId, l, i.paneIndex ?? ("onchart" === o.placement ? this._host._primaryIndex() : this._host._panes.length), this._host._primaryIndex()), this._flushIndicators();
			const h = this._host._series._sharedAxis(), c = /* @__PURE__ */ new Set([...this._host._indicatorReservedIds, ...this._host._indicators.map((e) => e.id)]);
			for (const e of Ts(this._host._indicators.map((e) => e.dependencyNode())).dependencies.values()) for (const t of e) c.add(t.source.instanceId);
			const d = new Xr(this._indicatorHost(), o, this._distinctColors(o, a), i.paneIndex, s, c, i.priceScaleId, l, r, n);
			return this._host._indicators.push(d), this._invalidateStudies([d.id], h), this._host._legendStack._restackLegends(), this._host._indicatorReservedIds.add(d.id), this._queueIndicatorDependents(d.id, !0), this._host._emit("objects:change", {}), d;
		}
		_distinctColors(e, t) {
			const i = this._host._indicators.filter((t) => t.indicatorId === e.id).length;
			if (0 === i) return t;
			const s = { ...t }, r = e.plots;
			for (let e = 0; e < r.length; e++) {
				const t = ns(r[e]).color;
				void 0 === s[t] && (s[t] = Ao[(i * r.length + e) % Ao.length]);
			}
			return s;
		}
		indicators() {
			return this._flushIndicators(), this._host._indicators;
		}
		moveIndicator(e, t, s) {
			const r = this._host._indicators.find((t) => t.id === e);
			if (this._host.isDestroyed || !r || !this._host._policyAllows(r, "movable", s) || !Number.isInteger(t) || t < 0 || t > this._host._panes.length || r.paneIndex === t || !r.canRelocate(t)) return !1;
			const n = r.paneIndex, o = t === this._host._panes.length;
			this._host._layout._ensurePane(t);
			const a = this._host._panes[t], l = r.renderResources();
			for (const { api: e, overlay: t } of l.series) {
				if (t) continue;
				const i = this._host._seriesOwners.get(e), s = this._host._seriesRecords.get(e);
				if (!i || !s || i.pane === a) continue;
				const r = i.pane.scaleOf(s).options;
				i.pane.removeSeries(s), a.addSeries(s), i.pane = a, o && 1 === a.series().filter((e) => e.scaleId === s.scaleId).length && a.scaleOf(s).setOptions(r), this._host._series._applySeriesPriceFormat(a.scaleOf(s), i.priceFormat), void 0 !== s.style.precision && this._host._series._applyPrecision(a.scaleOf(s), s.style.precision);
			}
			for (const { primitive: e, overlay: t } of l.primitives) t || this._host._panes.find((t) => t.hasPrimitive(e))?.transferPrimitive(e, a);
			r.relocate(t), this._host._primitives._reanchorSource(), this._host._legendStack._syncLegendPanes(), this._host._emit("objects:change", {});
			const h = this._host._panes[n];
			return this._host._layout._holdsOnlyFurniture(h) && this._host.removePane(n), this._reorderIndicatorResources(), this._host._layout._recomputeAxisColumns(), this._host._layout._relayout(), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._emit("objects:change", {}), !0;
		}
		reorderIndicator(e, t, s) {
			if (-1 !== t && 1 !== t) return !1;
			const r = this._host._indicators.findIndex((t) => t.id === e);
			if (this._host.isDestroyed || r < 0 || !this._host._policyAllows(this._host._indicators[r], "movable", s)) return !1;
			const n = this._host._indicators[r].paneIndex;
			let o = r + t;
			for (; o >= 0 && o < this._host._indicators.length && this._host._indicators[o].paneIndex !== n;) o += t;
			return !(o < 0 || o >= this._host._indicators.length) && ([this._host._indicators[r], this._host._indicators[o]] = [this._host._indicators[o], this._host._indicators[r]], this._reorderIndicatorResources(), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._emit("objects:change", {}), !0);
		}
		_reorderIndicatorResources() {
			for (const e of this._host._indicators) e.refreshBarColors();
			const e = this._host._indicators.map((e) => e.renderResources()), t = e.flatMap((e) => e.series.flatMap(({ api: e }) => {
				const t = this._host._seriesRecords.get(e);
				return t ? [t] : [];
			})), i = e.flatMap((e) => e.primitives.map((e) => e.primitive));
			for (const e of this._host._panes) e.reorderSeries(t), e.reorderPrimitives(i);
			const s = this._host._indicators.flatMap((e) => e.legend() ? [e.legend()] : []), r = new Set(s);
			let n = 0;
			for (const e of this._host._legends) r.has(e.legend) && (e.legend = s[n++]);
			this._host._primitives._placeSource(), this._host._legendStack._syncLegendPanes();
		}
		removeIndicator(e, t) {
			const i = this._host._indicators.find((t) => t.id === e);
			return void 0 !== i && i.remove(t);
		}
		_forgetIndicator(e, t) {
			const i = this._host._indicators.findIndex((t) => t.id === e);
			if (i < 0) {
				const e = void 0 === t ? void 0 : this._host._panes[t];
				void 0 !== t && void 0 !== e && this._host._layout._holdsOnlyFurniture(e) && this._host.removePane(t);
				return;
			}
			const { indicatorId: s, paneIndex: r } = this._host._indicators[i];
			this._host._indicators.splice(i, 1), this._host._primitives._reanchorSource(), this._host._legendStack._restackLegends(), this._host._indicatorReservedIds.add(e), this._host._indicatorRefreshes.delete(e), this._queueIndicatorDependents(e, !0), this._host._emit("indicatorRemoved", {
				instanceId: e,
				indicatorId: s,
				paneIndex: r
			});
			const n = this._host._panes[r];
			void 0 !== n && n !== this._host._primaryPane && 0 === n.series().length && this._host.removePane(r);
		}
		_indicatorHost(e) {
			return {
				assignIndicatorScale: (e, t, i, s) => this._assignIndicatorScale(e, t, i, s),
				bindIndicatorPrimitiveScale: (e, t) => {
					const s = this._host._panes.find((t) => t.hasPrimitive(e));
					s?.bindPrimitiveScale(e, t), this._host._layout._recomputeAxisColumns();
					const r = void 0 === s ? -1 : this._host._panes.indexOf(s);
					this._host.invalidate((e) => r < 0 ? e.invalidateGlobal(i.Full) : e.invalidatePane(r, {
						level: i.Full,
						autoScale: !0
					}));
				},
				setIndicatorRange: (e, t, i, s, r) => {
					const n = this._host._indicatorRanges.get(e), o = this._host._panes[t];
					s && o ? this._host._indicatorRanges.set(e, {
						pane: o,
						scaleId: i,
						range: s,
						series: r,
						token: n?.token ?? {}
					}) : this._host._indicatorRanges.delete(e), this._reconcileIndicatorRanges();
				},
				legendIndex: () => this._host._readoutIndex(),
				indicatorRemoved: (e, t) => this._forgetIndicator(e, t),
				flushIndicators: () => this._flushIndicators(),
				validateIndicatorSettings: (e, t, i) => {
					const s = this._host._indicators.filter((t) => t.id !== e).map((e) => e.dependencyNode());
					s.push({
						id: e,
						descriptor: t,
						settings: i
					}), Ts(s);
				},
				studyOutput: (e) => this._host._indicators.find((t) => t.id === e.instanceId)?.studyOutput(e.plotKey),
				indicatorOutputChanged: (e, t) => this._queueIndicatorDependents(e, t),
				indicatorRecompute: (e, t, i) => {
					if (!this._host._indicators.some((t) => t.id === e)) return void i();
					if (this._recomputing) return i(), this._indicatorWork?.delete(e), void this._indicatorProcessed?.add(e);
					this._host._indicatorRefreshes.set(e, t || !0 === this._host._indicatorRefreshes.get(e)), this._queueIndicatorDependents(e, t);
					const s = this._host._indicatorsDirty;
					this._flushIndicators(), s && (this._host._indicatorsDirty = !0, this._host._loop.requestFrame());
				},
				resourcesChanged: () => this._reorderIndicatorResources(),
				formatPrice: (e, t, i) => (i?.priceScale() ?? this._host._panes[e]?.priceScale)?.format(t),
				policyChanged: () => {
					this._host._legendStack._restackLegends(), this._host._emit("objects:change", {});
				},
				addIndicatorLegend: (e) => {
					const t = [
						"hide",
						"settings",
						"close"
					];
					!0 === e.hasSource && t.splice(t.indexOf("settings") + 1, 0, "source");
					const i = new Oi({
						...e,
						actions: t
					});
					return this._host._legendActions.set(i, [t, i.options().actions]), this._host._studyLegends.add(i), this._host._primitives._addPrimitive(e.paneIndex, i), i;
				},
				removeIndicatorLegend: (e) => {
					this._host._studyLegends.delete(e), this._host.removePrimitive(e), this._host._legendStack._restackLegends();
				},
				legendRowsOn: (e) => this._host._legends.filter((t) => t.paneIndex === e).length,
				primarySeries: () => this._host.primarySeries(),
				setIndicatorSeriesType: (e, t) => this._host._series._setSeriesType(e, t, !1),
				addIndicatorSeries: (t, i, s, r, n) => this._host._series._createSeries(t, {
					paneIndex: i,
					style: s,
					priceScaleId: r,
					priceFormat: n
				}, !1, e),
				addIndicatorLevel: (e, t) => {
					const i = {
						price: e.price,
						color: e.color,
						lineWidth: e.lineWidth,
						lineStyle: e.lineStyle,
						leftLabel: e.label,
						id: e.id
					};
					return this._host.addPriceLine(i, t);
				},
				removeIndicatorLevel: (e) => this._host.removePrimitive(e),
				addIndicatorFill: (e, t) => this._host._primitives._addPrimitive(t, e),
				removeIndicatorFill: (e) => this._host.removePrimitive(e),
				removeIndicatorMarkers: (e) => this._host.removePrimitive(e),
				addIndicatorPrimitive: (e, t) => this._host._primitives._addPrimitive(t, e),
				removeIndicatorPrimitive: (e) => this._host.removePrimitive(e),
				addIndicatorTable: (e) => {
					const t = new jo();
					return this._host._primitives._addPrimitive(e, t), t;
				},
				removeIndicatorTable: (e) => this._host.removePrimitive(e),
				sourceBars: () => null === this._host._firstDataId.value ? [] : this._host._dataLayer.seriesBars(this._host._firstDataId.value),
				underlyingBars: () => this._host._series._underlying(this._host._firstDataId.value),
				sourceState: () => {
					const e = this._host._seriesProvenance.get(this._host._firstDataId.value ?? -1)?.snapshot(), t = bo(this._chart);
					return e && t ? {
						...e,
						provenance: "replay",
						confirmation: t.forming ? "forming" : "confirmed",
						confirmationSource: "replay"
					} : e;
				},
				nextPaneIndex: () => this._host._panes.length,
				primaryPaneIndex: () => this._host._primaryIndex(),
				timezone: () => this._host._timezone,
				now: () => this._host._wallClock(),
				symbol: () => this._host._dataContext?.symbol,
				interval: () => this._host._dataContext?.interval,
				dataContext: () => this._host._dataContext,
				requestBars: (e) => {
					const t = this._host._barsProvider;
					return null === t ? Promise.reject(/* @__PURE__ */ new Error("openalgo-charts: this chart has no bars provider; call chart.setBarsProvider(...) to serve other instruments")) : bs((i) => "function" == typeof t ? t({
						...e,
						signal: i
					}) : t.requestBars({
						...e,
						signal: i
					}), [e.signal, this._host._barsRequests.signal]);
				},
				requestSnapshot: (e) => {
					const t = this._host._barsProvider;
					return bs((i) => {
						if ("object" != typeof t || void 0 === t?.requestSnapshot) throw new Error("Requested snapshots are unsupported by this provider");
						const s = bo(this._chart);
						if (s && void 0 === s.asOf) throw new Error("Requested snapshots require an availability clock during replay");
						if (void 0 !== e.asOf && !Number.isFinite(e.asOf)) throw new RangeError("Requested availability time must be finite");
						const r = void 0 === s?.asOf ? e.asOf : Math.min(e.asOf ?? 1 / 0, s.asOf);
						return t.requestSnapshot({
							...e,
							...void 0 === r ? {} : { asOf: r },
							signal: i
						});
					}, [e.signal, this._host._barsRequests.signal]);
				},
				requestState: () => ({
					source: this._host._seriesProvenance.get(this._host._firstDataId.value ?? -1)?.snapshot(),
					providerRevision: this._host._barsProviderRevision,
					dataRevision: this._host._requestedDataRevision,
					supportsSnapshots: this._host.hasSnapshotProvider(),
					replay: bo(this._chart)
				}),
				subscribeRequestChanges: (e) => {
					const t = [
						"data:context",
						"data:range",
						"data:requests"
					].map((t) => this._host.on(t, e));
					return t.push(yo(this._chart, e)), () => {
						for (const e of t) e();
					};
				},
				subscribeDataChanges: (e) => {
					const t = this._host.on("data:context", () => e("context")), i = this._host.on("data:range", () => e("range"));
					return () => {
						t(), i();
					};
				},
				tickSize: (e) => {
					const i = (this._host._panes[e] ?? this._host._primaryPane)?.priceScale.options.minMove ?? 0;
					return i > 0 ? i : void 0;
				},
				setBarColors: (e, t) => this._setBarColors(e, t),
				emit: (e, t) => this._host._bus.emit(e, t),
				setPaneRange: (e, t) => {
					const i = this._host._panes[e];
					if (void 0 === i) return;
					const s = i === this._host._primaryPane || this._host._indicators.filter((t) => t.paneIndex === e).length > 1;
					i.priceScale.setFixedRange(s ? null : t), null === t && i.priceScale.setAutoScale(!0);
				}
			};
		}
		_assignIndicatorScale(e, t, s, r) {
			if (this._host._destroyed || !this._host._indicators.some((t) => t.id === e)) return !1;
			for (const e of t) if (!L(e.scaleId) || null === this._host.seriesType(e.api)) return !1;
			for (const e of s) if (!L(e.scaleId) || !this._host._panes.some((t) => t.hasPrimitive(e.primitive))) return !1;
			this._host._scaleMutationDepth++;
			try {
				for (const { api: e, scaleId: i } of t) {
					const t = this._host._seriesRecords.get(e), s = this._host._seriesOwners.get(e), r = s.pane.scaleFor(i);
					t.scaleId = i, this._host._series._applySeriesPriceFormat(r, s.priceFormat), void 0 !== t.style.precision && this._host._series._applyPrecision(r, t.style.precision);
				}
				for (const { primitive: e, scaleId: t } of s) this._host._panes.find((t) => t.hasPrimitive(e)).bindPrimitiveScale(e, t);
				r(), this._host._layout._recomputeAxisColumns();
			} finally {
				this._host._scaleMutationDepth--, this._host.invalidate((e) => e.invalidateGlobal(i.Full));
			}
			return this._host._emit("objects:change", {}), !0;
		}
		_reconcileIndicatorRanges() {
			const e = /* @__PURE__ */ new Map();
			for (const t of this._host._indicatorRanges.values()) {
				if (!this._host._panes.includes(t.pane)) continue;
				const i = t.pane.scaleFor(t.scaleId);
				if (e.has(i)) continue;
				const s = [...this._host._indicatorRanges.values()].filter((e) => e.pane === t.pane && e.scaleId === t.scaleId && e.range.min === t.range.min && e.range.max === t.range.max), r = new Set(s.flatMap((e) => e.series.flatMap((e) => {
					const t = this._host._seriesRecords.get(e);
					return t ? [t] : [];
				})));
				t.pane.series().some((e) => e.scaleId === t.scaleId && !r.has(e)) || e.set(i, t);
			}
			for (const [t, i] of this._host._ownedScaleRanges) e.has(t) || (t.clearOwnedFixedRange(i), this._host._ownedScaleRanges.delete(t));
			for (const [t, i] of e) {
				const e = this._host._ownedScaleRanges.get(t) ?? i.token;
				t.setOwnedFixedRange(e, i.range) ? this._host._ownedScaleRanges.set(t, e) : t.ownsFixedRange(e) || this._host._ownedScaleRanges.delete(t);
			}
		}
		_setBarColors(e, t) {
			if (null === e) {
				if (this._barColorOwner !== t) return;
				this._barColorOwner = null;
			} else this._barColorOwner = t;
			this._barColors = e, this._applyBarColors();
		}
		_applyBarColors() {
			const e = this._host._firstDataId.value;
			if (null === e) return;
			const t = this._host._dataLayer.seriesBars(e), s = t.length, r = this._barColorBase;
			(s < r.length || r.length > 0 && t[0].time !== this._barColorAnchor) && (r.length = 0), 0 === r.length && (this._barColorAnchor = s > 0 ? t[0].time : 0);
			for (let e = r.length; e < s; e++) r[e] = t[e].color;
			const n = this._barColors, o = new Array(s);
			let a = !1;
			for (let e = 0; e < s; e++) {
				const i = t[e], s = n?.[e] ?? r[e];
				s !== i.color ? (o[e] = {
					...i,
					color: s
				}, a = !0) : o[e] = i;
			}
			if (!a) return;
			this._host._dataLayer.setSeriesData(e, o);
			const l = this._host._panes.findIndex((t) => t.series().some((t) => t.dataId === e));
			this._host.invalidate((e) => {
				l < 0 ? e.invalidateGlobal(i.Light) : e.invalidatePane(l, {
					level: i.Light,
					autoScale: !1
				});
			});
		}
		_invalidateIndicators() {
			this._host._emit("data:range", {}), 0 !== this._host._indicators.length && (this._host._indicatorsDirty = !0, this._host._loop.requestFrame());
		}
		_flushIndicators() {
			if (!this._host._indicatorsDirty && 0 === this._host._indicatorRefreshes.size) return;
			if (this._recomputing) return;
			if (0 === this._host._indicators.length) return this._host._indicatorsDirty = !1, void this._host._indicatorRefreshes.clear();
			const e = this._host._indicatorsDirty, t = this._host._series._sharedAxis(), i = Ts(this._host._indicators.map((e) => e.dependencyNode())).order, s = new Map(this._host._indicatorRefreshes);
			if (this._host._indicatorRefreshes.clear(), e) for (const e of i) s.has(e) || s.set(e, !1);
			this._host._indicatorsDirty = !1, this._recomputing = !0, this._indicatorWork = s;
			const r = /* @__PURE__ */ new Set();
			this._indicatorProcessed = r;
			try {
				for (const e of i) {
					if (!s.has(e) || r.has(e)) continue;
					const t = this._host._indicators.find((t) => t.id === e);
					t && (r.add(e), t.recompute(s.get(e)));
				}
				for (const e of this._host._indicators) e.republishBarColors();
			} finally {
				this._indicatorWork = null, this._indicatorProcessed = null, this._recomputing = !1, this._invalidateStudies(r, t);
			}
		}
		_invalidateStudies(e, t) {
			const i = /* @__PURE__ */ new Set();
			for (const t of e) {
				const e = this._host._indicators.find((e) => e.id === t)?.renderResources();
				for (const { api: t } of e?.series ?? []) {
					const e = this._host._seriesOwners.get(t)?.pane;
					void 0 !== e && i.add(e);
				}
				for (const { primitive: t } of e?.primitives ?? []) {
					const e = this._host._panes.find((e) => e.hasPrimitive(t));
					void 0 !== e && i.add(e);
				}
			}
			this._host._series._invalidateWrite(i, t);
		}
		_queueIndicatorDependents(e, t) {
			const i = Ts(this._host._indicators.map((e) => e.dependencyNode())), s = [e], r = new Set(s);
			for (let e = 0; e < s.length; e++) for (const [n, o] of i.dependencies) {
				if (r.has(n) || !o.some((t) => t.source.instanceId === s[e])) continue;
				r.add(n), s.push(n), this._host._indicators.find((e) => e.id === n)?.invalidateStudyOutput();
				const i = this._indicatorWork && !this._indicatorProcessed?.has(n) ? this._indicatorWork : this._host._indicatorRefreshes;
				i.set(n, t || !0 === i.get(n));
			}
			this._host._indicatorRefreshes.size > 0 && this._host._loop.requestFrame();
		}
	};
	function No(e) {
		return Math.max(-2, Math.min(2, -e * Math.log(1.1) / 100));
	}
	function Ro(e, t) {
		return {
			dist: Math.hypot(e.x - t.x, e.y - t.y),
			cx: (e.x + t.x) / 2,
			cy: (e.y + t.y) / 2
		};
	}
	var Fo = "indicator-legend::toggle";
	var zo = class {
		constructor() {
			Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_bounds", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_options", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: {
					count: 0,
					collapsed: !1,
					left: 8,
					top: 6,
					height: 18
				}
			});
		}
		attached(e) {
			this._host = e;
		}
		detached() {
			this._host = null, this._bounds = null;
		}
		zOrder() {
			return "top";
		}
		setOptions(e) {
			Object.keys(e).every((t) => e[t] === this._options[t]) || (this._options = e, this._bounds = null, this._host?.requestUpdate());
		}
		draw(e, t) {
			this._bounds = null;
			const i = this._options, s = t.dpr, r = i.height;
			if (0 === i.count || t.plotWidth < 18 || i.top < 0 || i.top + r > t.plotHeight) return;
			e.save(), e.font = `500 ${11 * s}px ui-sans-serif, system-ui, sans-serif`;
			let n = `Indicators ${i.count}`;
			e.measureText(n).width / s + 24 > t.plotWidth && (n = String(i.count));
			const o = Math.min(t.plotWidth, e.measureText(n).width / s + 24), a = Math.max(0, Math.min(i.left, t.plotWidth - o)), l = i.top;
			this._bounds = {
				x: a,
				y: l,
				width: o,
				height: r
			}, e.beginPath(), e.rect(a * s, l * s, o * s, r * s), e.clip(), e.fillStyle = ie(t.theme.background, .9), e.beginPath(), e.roundRect(a * s, l * s, o * s, r * s, 3 * s), e.fill(), e.strokeStyle = t.theme.axisText, e.lineWidth = s;
			const h = (a + 8) * s, c = (l + r / 2) * s, d = 3 * s;
			e.beginPath(), i.collapsed ? (e.moveTo(h - d / 2, c - d), e.lineTo(h + d / 2, c), e.lineTo(h - d / 2, c + d)) : (e.moveTo(h - d, c - d / 2), e.lineTo(h, c + d / 2), e.lineTo(h + d, c - d / 2)), e.stroke(), e.fillStyle = t.theme.axisText, e.textBaseline = "middle", e.textAlign = "left", e.fillText(n, (a + 16) * s, c), e.restore();
		}
		hitTest(e, t) {
			const i = this._bounds;
			return i && e >= i.x && e < i.x + i.width && t >= i.y && t < i.y + i.height ? {
				externalId: Fo,
				zOrder: "top",
				distance: 0,
				cursor: "pointer"
			} : null;
		}
	};
	function Eo(e) {
		const t = e.pointerType;
		return {
			modifiers: {
				shift: !0 === e.shiftKey,
				alt: !0 === e.altKey,
				ctrl: !0 === e.ctrlKey,
				meta: !0 === e.metaKey
			},
			pointerType: "touch" === t || "pen" === t ? t : "mouse",
			pressure: Bo(e)
		};
	}
	function Bo(e) {
		const t = e.pressure;
		return "number" == typeof t && Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0 !== (e.buttons ?? 0) ? .5 : 0;
	}
	var $o = class {
		constructor(e) {
			Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_pointerInside", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_keyTarget", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_cursorPane", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_cursor", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_dragging", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_navigationCancelled", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_dragStartX", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_dragStartY", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_lastDragY", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_endedPointers", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Set()
			}), Object.defineProperty(this, "_pointers", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_pinch", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_pinchPane", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_dragStartOffset", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_indicatorTogglePress", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_lastPressOnIndicatorToggle", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_previousPressOnIndicatorToggle", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_clickCbs", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Set()
			}), Object.defineProperty(this, "_crosshairCbs", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Set()
			}), Object.defineProperty(this, "_readoutTime", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_pointerMoved", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_placementMode", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_downPane", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_downX", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_downLocalY", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_downPressure", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_dragId", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_dragPriceScale", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_dragCancelOnEscape", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_hoverId", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_hoverKey", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_hoverOnBase", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_overlayFrozen", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_timeNavButtons", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_dragCbs", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Set()
			}), Object.defineProperty(this, "_axisDrag", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_axisDragScale", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_dragMoved", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_dragFrom", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: {
					time: 0,
					price: 0
				}
			}), Object.defineProperty(this, "_paneResize", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_axisStartCoord", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_axisStartMin", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_axisStartMax", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_axisStartSpacing", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_brandingPress", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), this._host = e;
		}
		_attachInput() {
			if ("undefined" == typeof window) return;
			const e = this._host._container;
			e.addEventListener("pointerdown", this._host._onPointerDown), e.addEventListener("pointermove", this._host._onPointerMove), e.addEventListener("pointerup", this._host._onPointerUpNative), e.addEventListener("pointercancel", this._host._onPointerCancel), e.addEventListener("lostpointercapture", this._host._onLostPointerCapture), e.addEventListener("pointerleave", this._host._onPointerLeave), e.addEventListener("wheel", this._host._onWheel, { passive: !1 }), e.addEventListener("dblclick", this._host._onDblClick), e.addEventListener("pointerenter", this._host._onPointerEnter), e.addEventListener("contextmenu", this._host._onContextMenu);
			const t = "function" == typeof this._host._doc.addEventListener ? this._host._doc : e;
			t.addEventListener("keydown", this._host._onKeyDown), this._keyTarget = t;
		}
		_detachInput() {
			if ("undefined" == typeof window) return;
			const e = this._host._container;
			e.removeEventListener("pointerdown", this._host._onPointerDown), e.removeEventListener("pointermove", this._host._onPointerMove), e.removeEventListener("pointerup", this._host._onPointerUpNative), e.removeEventListener("pointercancel", this._host._onPointerCancel), e.removeEventListener("lostpointercapture", this._host._onLostPointerCapture), e.removeEventListener("pointerleave", this._host._onPointerLeave), e.removeEventListener("wheel", this._host._onWheel), e.removeEventListener("dblclick", this._host._onDblClick), e.removeEventListener("pointerenter", this._host._onPointerEnter), e.removeEventListener("contextmenu", this._host._onContextMenu), this._keyTarget?.removeEventListener("keydown", this._host._onKeyDown), this._keyTarget = null;
		}
		_onPointerEnter() {
			this._pointerInside = !0;
		}
		_onContextMenu(e) {
			if (e.defaultPrevented) return;
			const t = this._localPoint(e), i = this._host._panes[t.pane];
			if (void 0 !== i) if (this._host._bus.has("contextmenu")) this._host._emit("contextmenu", this._contextMenuEvent(e, t));
			else {
				this._cursor = null, this._cursorPane = null;
				try {
					const e = i.top.ctx;
					e.save(), e.globalCompositeOperation = "destination-over", e.drawImage(i.base.element, 0, 0), e.restore(), this._overlayFrozen = !0;
				} catch {}
			}
		}
		_contextMenuEvent(e, t) {
			const i = t.x - this._host._leftAxisWidth, s = i >= 0 && t.x < this._host._width - this._host._rightAxisWidth, r = s ? Math.round(this._host._timeScale.xToIndex(i)) : null;
			return s && this._host._ensureScaled(t.pane), {
				paneIndex: t.pane,
				point: {
					x: t.x,
					y: t.y
				},
				price: s ? this._priceAt(t.pane, t.localY) : null,
				time: null === r ? null : this._host._dataLayer.indexToTime(r) ?? null,
				index: r,
				target: this._contextTarget(t, s, r),
				preventDefault: () => e.preventDefault()
			};
		}
		_contextTarget(e, t, i) {
			const s = e.pane === this._host._bottomPaneIndex(), r = e.x >= this._host._width - this._host._rightAxisWidth;
			if (s && e.localY >= e.paneHeight - this._host._timeAxisHeight && !r) return {
				kind: "time-scale",
				id: null
			};
			if (!t) {
				const t = this._axisAt(e.pane, e.x);
				return t ? {
					kind: "price-scale",
					id: null,
					side: t.side,
					scaleId: t.scaleId
				} : {
					kind: "empty",
					id: null
				};
			}
			const n = this._host._panes[e.pane], o = this._host._renderContext(e.pane), a = this._hitAt(e.pane, e.x, e.localY), l = null === i || this._host._layout._collapsedShown(e.pane) ? null : this._seriesAt(e.pane, i, e.localY);
			if (null != a && (null === l || void 0 === a.paintedBy || !n.paintsBelowSeries(a.paintedBy, l, o))) {
				const e = a.externalId;
				if (e.startsWith("draw:")) return {
					kind: "drawing",
					id: e
				};
				if (e.startsWith("indicator:")) {
					const t = e.lastIndexOf("::");
					return {
						kind: "indicator",
						id: e,
						instanceId: e.slice(10, t < 0 ? void 0 : t)
					};
				}
				return e.endsWith("::row") ? {
					kind: "legend",
					id: e
				} : {
					kind: "primitive",
					id: e
				};
			}
			if (null === l) return {
				kind: "empty",
				id: null
			};
			for (const e of this._host._indicators) for (const t of ds(e.indicatorId).plots) {
				const i = e.series(t.key);
				if (i && this._host._seriesRecords.get(i) === l) return {
					kind: "indicator",
					id: `indicator:${e.id}`,
					instanceId: e.id,
					plotKey: t.key
				};
			}
			return {
				kind: "series",
				id: null,
				seriesType: l.type
			};
		}
		_axisAt(e, t) {
			return this._host.priceAxisLayout(e).find((e) => t >= e.x && t < e.x + e.width);
		}
		_seriesAt(e, t, i) {
			const s = this._host._panes[e];
			if (void 0 === s) return null;
			const r = s.series();
			for (let e = r.length - 1; e >= 0; e--) {
				const n = r[e];
				if (!1 === n.style.visible) continue;
				const o = j(this._host._dataLayer, n.dataId, t);
				if (void 0 === o) continue;
				const a = je(n.type).extents(o, n.style);
				if (!isFinite(a.min) || !isFinite(a.max)) continue;
				const l = s.scaleOf(n), h = l.priceToY(a.max), c = l.priceToY(a.min);
				if (i >= Math.min(h, c) - 3 && i <= Math.max(h, c) + 3) return n;
			}
			return null;
		}
		_priceAt(e, t) {
			return this._host._layout._collapsedShown(e) ? null : this._host._panes[e]?.yToPrice(t) ?? null;
		}
		_unfreezeOverlay() {
			this._overlayFrozen && (this._overlayFrozen = !1, this._host.invalidate((e) => e.invalidateGlobal(i.Cursor)));
		}
		_localPoint(e) {
			const t = this._host._container.getBoundingClientRect();
			return this._project(e.clientX - t.left, e.clientY - t.top, this._host._paneLayout());
		}
		_project(e, t, i) {
			let s = 0;
			for (let e = 0; e < i.length; e++) t >= i[e].top && (s = e);
			const r = i[s] ?? {
				top: 0,
				height: this._host._height
			};
			return {
				x: e,
				y: t,
				pane: s,
				localY: t - r.top,
				paneHeight: r.height
			};
		}
		_dragSamples(e) {
			const t = "function" == typeof e.getCoalescedEvents ? e.getCoalescedEvents() : [], i = t.length > 0 ? t : [e], s = this._host._container.getBoundingClientRect(), r = this._host._paneLayout(), n = [];
			for (const e of i) {
				const t = this._project(e.clientX - s.left, e.clientY - s.top, r);
				n.push({
					x: t.x,
					y: null === this._dragId ? t.localY : t.y - (r[this._downPane]?.top ?? 0),
					pressure: Bo(e)
				});
			}
			return n;
		}
		_clickInfo(e) {
			const t = Eo(e);
			return t.pressure = this._downPressure, {
				...t,
				shiftKey: t.modifiers.shift,
				ctrlKey: t.modifiers.ctrl,
				metaKey: t.modifiers.meta
			};
		}
		_onPointerDown(e) {
			if (this._unfreezeOverlay(), ("mouse" === e.pointerType || "pen" === e.pointerType) && 0 !== e.button) return;
			this._previousPressOnIndicatorToggle = this._lastPressOnIndicatorToggle, this._lastPressOnIndicatorToggle = !1, this._endedPointers.delete(e.pointerId), 0 === this._pointers.size && (this._navigationCancelled = !1), this._host._motion._stopKinetic(), this._host._motion._stopZoomGlide();
			const t = this._localPoint(e);
			this._pointers.set(e.pointerId, {
				x: t.x,
				y: t.y,
				pane: t.pane
			});
			try {
				this._host._container.setPointerCapture?.(e.pointerId);
			} catch {}
			if (this._navigationCancelled) return;
			if (this._pointers.size >= 2) return void this._beginPinch();
			this._downPane = t.pane, this._downX = t.x, this._downLocalY = t.localY, this._downPressure = Bo(e);
			const i = this._host._layout._dividerAt(t.y);
			if (null !== i) return void this._beginDividerResize(i, t);
			const s = Math.max(0, this._host._width - this._host._rightAxisWidth), r = this._host._leftAxisWidth > 0 && t.x < this._host._leftAxisWidth, n = t.x >= s || r, o = t.pane === this._host._bottomPaneIndex() && t.localY >= t.paneHeight - this._host._timeAxisHeight;
			if (n) return void this._beginPriceAxisDrag(t);
			if (o) return !1 === this._host._navigation.zoomEnabled ? void (this._axisDrag = "empty") : (this._axisDrag = "time", this._axisStartCoord = t.x, this._axisStartSpacing = this._host._timeScale.barSpacing, void (this._dragging = !1));
			if (this._host._legendStack._indicatorLegendHit(t.pane, t.x, t.localY)) return this._lastPressOnIndicatorToggle = !0, this._indicatorTogglePress = {
				pointerId: e.pointerId,
				moved: !1
			}, this._dragging = !1, void (this._pointerMoved = !1);
			const a = this._host._panes[t.pane]?.hitTestPrimitives(t.x - this._host._leftAxisWidth, t.localY, this._host._renderContext(t.pane), this._host._branding);
			null !== this._host._branding && !a && this._brandingHit(t.pane, t.x, t.localY) ? (this._brandingPress = {
				pointerId: e.pointerId,
				mark: this._host._branding,
				moved: !1
			}, this._dragging = !1, this._pointerMoved = !1) : this._placementMode ? (this._dragging = !1, this._pointerMoved = !1) : a && (!0 === a.draggable || "ns-resize" === a.cursor && this._dragCbs.size > 0) ? this._beginPrimitiveDrag(e, t, a) : (this._dragging = !1 !== this._host._navigation.panEnabled, this._setHover(a ?? null), this._pointerMoved = !1, this._dragStartX = t.x, this._dragStartY = t.y, this._lastDragY = t.y, this._dragStartOffset = this._host._timeScale.rightOffset, this._host._lastDragX = t.x, this._host._lastDragT = this._host._now(), this._host._dragVelocity = 0);
		}
		_onPointerMove(e) {
			if (this._unfreezeOverlay(), this._pointerInside = !0, this._pointers.size > 0 && !this._pointers.has(e.pointerId)) return;
			if (("mouse" === e.pointerType || "pen" === e.pointerType) && !(1 & e.buttons) && (this._pointers.has(e.pointerId) || this._dragging || null !== this._dragId || null !== this._axisDrag || null !== this._brandingPress || null !== this._indicatorTogglePress)) return null !== this._brandingPress && (this._brandingPress.moved = !0), null !== this._indicatorTogglePress && (this._indicatorTogglePress.moved = !0), this._host._onPointerUp(e), void this._endedPointers.add(e.pointerId);
			const t = this._localPoint(e);
			if (this._pointers.has(e.pointerId) && this._pointers.set(e.pointerId, {
				x: t.x,
				y: t.y,
				pane: t.pane
			}), !this._navigationCancelled) if (null === this._pinch) {
				if ("empty" !== this._axisDrag) if (null === this._indicatorTogglePress) if (null === this._brandingPress) {
					if ("price" === this._axisDrag) {
						const e = t.localY - this._axisStartCoord, s = Math.exp(.005 * e), r = (this._axisStartMin + this._axisStartMax) / 2, n = (this._axisStartMax - this._axisStartMin) / 2 * s, o = this._axisDragScale ?? this._host._panes[this._downPane].priceScale;
						o.setPriceRange({
							min: r - n,
							max: r + n
						}), o.setAutoScale(!1), this._host.invalidate((e) => e.invalidatePane(this._downPane, {
							level: i.Light,
							autoScale: !1
						}));
						return;
					}
					if (null !== this._paneResize) {
						const e = this._paneResize, s = e.aHeight + e.bHeight, r = e.aWeight + e.bWeight, n = Math.min(24, s / 4), o = Math.max(n, Math.min(s - n, e.aHeight + (t.y - e.startY)));
						this._host._panes[e.a].weight = o / s * r, this._host._panes[e.b].weight = r - this._host._panes[e.a].weight, this._host._layout._relayout(), this._host.invalidate((e) => e.invalidateGlobal(i.Full));
						return;
					}
					if ("time" === this._axisDrag) {
						this._host._motion._beginAutoscaleMotion();
						const e = t.x - this._axisStartCoord;
						this._host._mutateTimeScale(() => this._host._timeScale.setBarSpacing(this._axisStartSpacing * Math.exp(.005 * -e))), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._emitViewport("zoom");
						return;
					}
					(this._placementMode || !this._dragging) && this._pointers.size > 0 && this._movedFromPress(t.x, t.localY) && (this._pointerMoved = !0), null === this._dragId ? this._dragging ? this._movePan(e, t) : this._updateCursor(t.pane, t.x, t.localY, t.y, e) : this._movePrimitiveDrag(e, t);
				} else !this._movedFromPress(t.x, t.localY) && t.pane === this._downPane && ("mouse" !== e.pointerType || 1 & e.buttons) || (this._brandingPress.moved = !0);
				else (this._movedFromPress(t.x, t.localY) || t.pane !== this._downPane) && (this._indicatorTogglePress.moved = !0);
			} else this._updatePinch();
		}
		_onPointerUp(e) {
			if (this._pointers.size > 0 && !this._pointers.has(e.pointerId)) return;
			const t = this._indicatorTogglePress?.pointerId === e.pointerId ? this._indicatorTogglePress : null;
			t && (this._indicatorTogglePress = null), this._pointers.delete(e.pointerId);
			try {
				this._host._container.releasePointerCapture?.(e.pointerId);
			} catch {}
			if (this._endedPointers.has(e.pointerId)) return void this._endedPointers.delete(e.pointerId);
			if (this._navigationCancelled) return 0 === this._pointers.size && (this._navigationCancelled = !1), void this._endedPointers.add(e.pointerId);
			if (t) {
				const i = this._localPoint(e);
				this._endedPointers.add(e.pointerId), !t.moved && i.pane === this._downPane && Math.abs(i.x - this._downX) <= 3 && Math.abs(i.localY - this._downLocalY) <= 3 && this._host._legendStack._indicatorLegendHit(i.pane, i.x, i.localY) && this._host._handleLegendAction(Fo);
				return;
			}
			if (this._brandingPress?.pointerId === e.pointerId) {
				const t = this._brandingPress;
				this._brandingPress = null;
				const i = this._localPoint(e);
				if (!t.moved && t.mark === this._host._branding && i.pane === this._downPane && Math.abs(i.x - this._downX) <= 3 && Math.abs(i.localY - this._downLocalY) <= 3 && this._brandingHit(i.pane, i.x, i.localY)) {
					const e = t.mark.href();
					e && /^https?:\/\//i.test(e) && this._host._doc.defaultView?.open(e, "_blank", "noopener,noreferrer");
				}
				this._endedPointers.add(e.pointerId);
				return;
			}
			if (null !== this._pinch) return void (0 === this._pointers.size && (this._pinch = null, this._dragging = !1));
			if (null !== this._paneResize) return this._paneResize = null, void this._host._emit("paneResized", { paneIndex: this._downPane });
			if (null !== this._axisDrag) return this._axisDrag = null, void (this._axisDragScale = null);
			if (null !== this._dragId) return void this._endPrimitiveDrag(e);
			const i = this._dragging;
			this._dragging = !1, this._placementMode && this._pointerMoved ? this._endPlacement(e, i) : this._pointerMoved ? (i && this._setHover(null), i && !1 !== this._host._navigation.panEnabled && "touch" === e.pointerType && "pointercancel" !== e.type && Di.shouldAnimate(this._host._dragVelocity) && this._host._startKinetic(this._host._dragVelocity)) : this._endClick(e, i);
		}
		_movedFromPress(e, t) {
			return Math.abs(e - this._downX) > 3 || Math.abs(t - this._downLocalY) > 3;
		}
		_beginDividerResize(e, t) {
			const i = this._host._paneLayout(), [s, r] = e;
			this._paneResize = {
				a: s,
				b: r,
				startY: t.y,
				aWeight: this._host._panes[s].weight,
				bWeight: this._host._panes[r].weight,
				aHeight: i[s].height,
				bHeight: i[r].height
			}, this._dragging = !1;
		}
		_beginPriceAxisDrag(e) {
			const t = this._axisAt(e.pane, e.x);
			if (this._dragging = !1, !t || !1 === this._host._navigation.zoomEnabled) return void (this._axisDrag = "empty");
			this._axisDrag = "price", this._axisDragScale = this._host._panes[e.pane].scaleFor(t.scaleId), this._axisStartCoord = e.localY;
			const i = this._axisDragScale.priceRange();
			this._axisStartMin = i.min, this._axisStartMax = i.max, this._dragging = !1;
		}
		_beginPrimitiveDrag(e, t, s) {
			this._dragId = s.externalId, this._dragPriceScale = s.priceScale ?? null, this._dragCancelOnEscape = !0 === s.cancelOnEscape, this._dragMoved = !1, this._host._ensureScaled(t.pane), this._dragFrom = {
				time: this._host._xToTime(t.x),
				price: this._dragPriceScale?.yToPrice(t.localY) ?? this._host._panes[t.pane].yToPrice(t.localY)
			}, this._setHover(s), this._cursor = null, this._cursorPane = null, this._readoutTime = null, this._host.invalidate((e) => e.invalidateGlobal(i.Cursor)), this._dragging = !1, this._pointerMoved = !1;
			const r = {
				id: s.externalId,
				...this._dragFrom,
				paneIndex: this._downPane,
				point: {
					x: t.x,
					y: t.localY
				},
				...Eo(e)
			};
			this._host._emit("drag:start", r);
		}
		_movePrimitiveDrag(e, t) {
			const i = t.y - (this._host._paneLayout()[this._downPane]?.top ?? 0);
			this._movedFromPress(t.x, i) && (this._dragMoved = !0);
			const s = this._dragPriceScale?.yToPrice(i) ?? this._host._panes[this._downPane].yToPrice(i), r = this._host._xToTime(t.x);
			mn(this._dragCbs, {
				end: !1,
				id: this._dragId,
				price: s,
				time: r
			});
			const n = {
				id: this._dragId,
				price: s,
				time: r,
				paneIndex: this._downPane,
				fromPrice: this._dragFrom.price,
				fromTime: this._dragFrom.time,
				point: {
					x: t.x,
					y: i
				},
				samples: this._dragSamples(e),
				...Eo(e)
			};
			this._host._emit("drag", n);
		}
		_movePan(e, t) {
			this._host._motion._beginAutoscaleMotion();
			const s = t.x - this._dragStartX;
			if ((Math.abs(s) > 3 || Math.abs(t.y - this._dragStartY) > 3) && (this._pointerMoved = !0), this._pointerMoved && null !== this._hoverId && this._setHover(null), this._host._mutateTimeScale(() => this._host._timeScale.setRightOffset(this._dragStartOffset - s / this._host._timeScale.barSpacing)), "touch" === e.pointerType || "both" === this._host._navigation.mousePan) {
				const i = this._host._layout._collapsedShown(this._downPane) ? void 0 : this._host._panes[this._downPane]?.priceScale, s = t.y - this._dragStartY;
				i && ("touch" === e.pointerType || !i.autoScale || Math.abs(s) > 3) && i.panByPixels("touch" !== e.pointerType && i.autoScale ? s : t.y - this._lastDragY);
			}
			this._lastDragY = t.y;
			const r = this._host._now(), n = r - this._host._lastDragT;
			if (n > 0) {
				const e = (t.x - this._host._lastDragX) / n, i = Math.exp(-n / 50);
				this._host._dragVelocity = this._host._dragVelocity * i + e * (1 - i);
			}
			this._host._lastDragX = t.x, this._host._lastDragT = r, this._host._maybeLoadHistory(), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._emitViewport("pan");
		}
		_endPrimitiveDrag(e) {
			const t = this._localPoint(e), s = t.y - (this._host._paneLayout()[this._downPane]?.top ?? 0), r = this._dragPriceScale?.yToPrice(s) ?? this._host._panes[this._downPane].yToPrice(s), n = this._host._xToTime(t.x);
			mn(this._dragCbs, {
				end: !0,
				id: this._dragId,
				price: r,
				time: n
			});
			const o = {
				id: this._dragId,
				price: r,
				time: n,
				paneIndex: this._downPane,
				point: {
					x: t.x,
					y: s
				},
				...Eo(e)
			};
			if (this._host._emit("drag:end", o), !this._dragMoved) {
				const t = this._dragId;
				mn(this._clickCbs, t);
				const i = {
					id: t,
					price: r,
					time: n,
					paneIndex: this._downPane,
					point: {
						x: this._downX,
						y: this._downLocalY
					},
					...this._clickInfo(e)
				};
				this._host._emit("click", i);
			}
			this._dragId = null, this._dragPriceScale = null;
			const a = "touch" === e.pointerType ? null : this._hitAt(t.pane, t.x, t.localY);
			this._setHover(a), this._host.invalidate((e) => e.invalidateGlobal(i.Light));
		}
		_endPlacement(e, t) {
			t && this._setHover(null);
			const i = this._localPoint(e);
			this._host._ensureScaled(this._downPane);
			const s = this._clickInfo(e), r = {
				id: null,
				price: this._priceAt(this._downPane, this._downLocalY),
				time: this._host._xToTime(this._downX),
				paneIndex: this._downPane,
				point: {
					x: this._downX,
					y: this._downLocalY
				},
				...s
			};
			this._host._emit("click", r);
			const n = {
				id: null,
				price: this._priceAt(this._downPane, i.localY),
				time: this._host._xToTime(i.x),
				paneIndex: this._downPane,
				point: {
					x: i.x,
					y: i.localY
				},
				viaDrag: !0,
				...s
			};
			this._host._emit("click", n);
		}
		_endClick(e, t) {
			const i = this._hitAt(this._downPane, this._downX, this._downLocalY);
			if (t && this._setHover("touch" === e.pointerType ? null : i ?? null), i && this._host._handleLegendAction(i.externalId)) return;
			i && mn(this._clickCbs, i.externalId), this._host._ensureScaled(this._downPane);
			const s = {
				id: i?.externalId ?? null,
				price: this._priceAt(this._downPane, this._downLocalY),
				time: this._host._xToTime(this._downX),
				paneIndex: this._downPane,
				point: {
					x: this._downX,
					y: this._downLocalY
				},
				...this._clickInfo(e)
			};
			this._host._emit("click", s);
		}
		_onPointerUpNative(e) {
			("mouse" !== e.pointerType && "pen" !== e.pointerType || 0 === e.button) && this._host._onPointerUp(e);
		}
		_onPointerCancel(e) {
			this._cancelPrimitiveDrag("pointercancel"), this._pointers.has(e.pointerId) && (this._pointerMoved = !0), this._brandingPress?.pointerId === e.pointerId && (this._brandingPress.moved = !0), this._indicatorTogglePress?.pointerId === e.pointerId && (this._indicatorTogglePress.moved = !0), this._host._onPointerUp(e);
		}
		_onLostPointerCapture(e) {
			if (this._indicatorTogglePress?.pointerId === e.pointerId) return this._indicatorTogglePress.moved = !0, void this._host._onPointerUp(e);
			this._pointers.has(e.pointerId) && null === this._dragId && null === this._paneResize && null === this._brandingPress && ((null !== this._pinch || this._navigationCancelled) && (this._navigationCancelled = !0, this._pinch = null), this._dragging = !1, this._axisDrag = null, this._axisDragScale = null, this._host._dragVelocity = 0, this._pointerMoved = !0, this._pointers.delete(e.pointerId), 0 === this._pointers.size && (this._navigationCancelled = !1), this._endedPointers.add(e.pointerId), this._setHover(null));
		}
		_brandingHit(e, t, i) {
			const s = this._host._panes[e];
			if (null === this._host._branding || !s?.hasPrimitive(this._host._branding)) return null;
			const r = e === this._host._bottomPaneIndex();
			return this._host._branding.hitTest(t - this._host._leftAxisWidth, i, {
				timeScale: this._host._timeScale,
				priceScale: s.priceScale,
				dataLayer: this._host._dataLayer,
				plotWidth: this._host._width - this._host._leftAxisWidth - this._host._rightAxisWidth,
				plotHeight: (this._host._paneLayout()[e]?.height ?? 0) - (r ? this._host._timeAxisHeight : 0),
				priceAxisWidth: this._host._rightAxisWidth,
				dpr: this._host._pixelRatio(),
				theme: this._host._theme
			});
		}
		_hitAt(e, t, i) {
			return this._host._panes[e]?.hitTestPrimitives(t - this._host._leftAxisWidth, i, this._host._renderContext(e), this._host._branding) ?? this._brandingHit(e, t, i);
		}
		_onPointerLeave() {
			if (this._pointerInside = !1, this._host._feedTimeNav(null), null === this._dragId && this._setHover(null), null !== this._cursor) {
				this._cursor = null, this._cursorPane = null, this._host.invalidate((e) => e.invalidateGlobal(i.Cursor));
				for (const e of this._host._indicators) e.updateLegendValues();
				const e = {
					time: null,
					index: null,
					price: null,
					bar: null,
					point: null,
					paneIndex: null
				};
				mn(this._crosshairCbs, e), this._host._emit("crosshair:readout", e), this._host._emit("crosshair:move", e);
			}
		}
		_onWheel(e) {
			const t = function(e, t, i) {
				const s = e.deltaMode, r = e.deltaX ?? 0, n = e.deltaY ?? 0;
				return {
					x: Number.isFinite(r) ? r * (1 === s ? 16 : 2 === s ? t : 1) : 0,
					y: Number.isFinite(n) ? n * (1 === s ? 16 : 2 === s ? i : 1) : 0
				};
			}(e, this._host._width, this._host._height);
			if (0 === t.x && 0 === t.y) return;
			const s = this._localPoint(e), r = this._host._leftAxisWidth > 0 && s.x < this._host._leftAxisWidth, n = this._host._rightAxisWidth > 0 && s.x >= this._host._width - this._host._rightAxisWidth, o = !r && !n && !e.ctrlKey && !e.metaKey && (e.shiftKey || Math.abs(t.x) > Math.abs(t.y));
			if (o ? !1 === this._host._navigation.panEnabled : !1 === this._host._navigation.zoomEnabled) return;
			if (!o && 0 === t.y) return;
			if (this._unfreezeOverlay(), e.preventDefault(), this._host._motion._stopKinetic(), r || n) {
				if (0 === t.y) return;
				const e = this._axisAt(s.pane, s.x);
				if (!e) return;
				this._host._motion._stopZoomGlide();
				this._host._panes[s.pane].scaleFor(e.scaleId).scaleAtY(s.localY, Math.exp(-No(t.y))), this._host.invalidate((e) => e.invalidateGlobal(i.Full));
				return;
			}
			if (o) return this._host._motion._stopZoomGlide(), this._host._motion._beginAutoscaleMotion(), this._host._mutateTimeScale(() => this._host._timeScale.scrollByPixels(-(e.shiftKey && 0 === t.x ? t.y : t.x))), this._host._maybeLoadHistory(), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), void this._host._emitViewport("pan");
			if (0 === t.y) return;
			const a = "right" !== this._host._zoomAnchor || e.ctrlKey || e.metaKey ? Math.max(0, Math.min(this._host._timeScale.width, s.x - this._host._leftAxisWidth)) : this._host._timeScale.width, l = this._host._motion._remainingZoom(), h = this._host._timeScale.barSpacing, c = this._host._timeScale.constrainBarSpacing(h * Math.exp(l + No(t.y))), d = Math.log(c / h);
			if (this._host._motion._stopZoomGlide(), 0 === d) return;
			if (!this._host._animZoom || !qi.shouldAnimate(d)) return void this._host._motion._applyZoom(a, d);
			const u = d * qi.leadFraction(), _ = this._host._motion._navigationEpoch;
			this._host._motion._applyZoom(a, u), this._host._destroyed || _ !== this._host._motion._navigationEpoch || this._host._motion._startZoomGlide(a, d - u);
		}
		_onDblClick(e) {
			if (this._lastPressOnIndicatorToggle || this._previousPressOnIndicatorToggle) return;
			const t = this._localPoint(e);
			if (this._host._legendStack._indicatorLegendHit(t.pane, t.x, t.localY)) return;
			if (this._brandingHit(t.pane, t.x, t.localY) && !this._host._panes[t.pane]?.hitTestPrimitives(t.x - this._host._leftAxisWidth, t.localY, this._host._renderContext(t.pane), this._host._branding)) return;
			const i = {
				paneIndex: t.pane,
				x: t.x,
				y: t.y,
				handled: !1
			};
			this._host._emit("dblclick", i), this._placementMode || i.handled || ("reset" === this._host._doubleClick && !1 !== this._host._navigation.zoomEnabled ? this._host.resetScale() : "maximize" === this._host._doubleClick && this._host.maximizePane(t.pane));
		}
		_beginPinch() {
			this._cancelPrimitiveDrag("pinch"), this._brandingPress = null, this._indicatorTogglePress = null;
			const e = [...this._pointers.values()];
			this._pinch = Ro(e[0], e[1]), this._pinchPane = e[0].pane, this._dragging = !1, this._axisDrag = null, this._axisDragScale = null, this._dragId = null, this._pointerMoved = !0, this._dragPriceScale = null, this._setHover(null);
		}
		_updatePinch() {
			const e = [...this._pointers.values()];
			if (e.length < 2 || null === this._pinch) return;
			const t = Ro(e[0], e[1]), s = function(e, t) {
				return {
					factor: e.dist > 0 ? t.dist / e.dist : 1,
					dx: t.cx - e.cx,
					dy: t.cy - e.cy
				};
			}(this._pinch, t);
			this._pinch = t;
			const r = !1 !== this._host._navigation.zoomEnabled && 1 !== s.factor, n = !1 !== this._host._navigation.panEnabled && (0 !== s.dx || 0 !== s.dy);
			(r || n) && (this._host._motion._beginAutoscaleMotion(), this._host._mutateTimeScale(() => {
				r && this._host._timeScale.zoomAtX(t.cx, s.factor), n && this._host._timeScale.setRightOffset(this._host._timeScale.rightOffset - s.dx / this._host._timeScale.barSpacing);
			}), n && 0 !== s.dy && !this._host._layout._collapsedShown(this._pinchPane) && this._host._panes[this._pinchPane]?.priceScale.panByPixels(s.dy), this._host._maybeLoadHistory(), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._emitViewport(r ? "zoom" : "pan"));
		}
		_cancelPrimitiveDrag(e) {
			null !== this._dragId && (this._dragMoved = !0, this._host._emit("drag:cancel", {
				id: this._dragId,
				paneIndex: this._downPane,
				reason: e
			}));
		}
		_onKeyDown(e) {
			if (this._unfreezeOverlay(), "Escape" === e.key && this._dragCancelOnEscape && null !== this._dragId && !Nn.shouldIgnore(e.target)) {
				this._cancelPrimitiveDrag("escape"), this._dragId = null, this._dragPriceScale = null, this._dragging = !1, this._pointerMoved = !0;
				for (const e of this._pointers.keys()) this._endedPointers.add(e);
				this._pointers.clear(), this._setHover(null), this._host.invalidate((e) => e.invalidateGlobal(i.Light)), e.preventDefault();
				return;
			}
			const t = this._host._shortcuts;
			if (null === t || Nn.shouldIgnore(e.target) || !this._shortcutsActive()) return;
			const s = t.resolve(e);
			if (null === s) return;
			if (!this._navigationAllowed(s)) return;
			let r = this._runShortcut(s);
			r || (r = t.runCustom(s)), r && (e.preventDefault(), t.emitTrigger(s), this._host._maybeLoadHistory(), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._updateAccessibleSummary());
		}
		_hovered() {
			return !!this._pointerInside && (!1 !== this._host._container.isConnected || (this._pointerInside = !1, !1));
		}
		_shortcutsActive() {
			if (null === this._host._shortcuts) return !1;
			if ("global" === this._host._shortcuts.scope || this._hovered()) return !0;
			const e = this._host._doc.activeElement;
			return null !== e && (e === this._host._container || !0 === this._host._container.contains?.(e));
		}
		_runShortcut(e) {
			if (!this._navigationAllowed(e)) return !1;
			const t = this._host._timeScale, i = (e) => {
				this._host._motion._stopZoomGlide(), this._host._motion._beginAutoscaleMotion();
				const i = t.visibleRange();
				return this._host._mutateTimeScale(() => t.setRightOffset(t.rightOffset + e)), this._host._emitViewportIfMoved(i), !0;
			}, s = (e) => {
				this._host._motion._stopZoomGlide(), this._host._motion._beginAutoscaleMotion();
				const i = t.visibleRange();
				return this._host._mutateTimeScale(() => t.zoomAtX(this._host._width / 2, e)), this._host._emitViewportIfMoved(i), !0;
			};
			switch (e) {
				case "panLeftBar": return i(-1);
				case "panRightBar": return i(1);
				case "panLeft": return i(-2);
				case "panRight": return i(2);
				case "panLeftFast": return i(-10);
				case "panRightFast": return i(10);
				case "panUp": return this._host._primaryPane.priceScale.panByPixels(20), !0;
				case "panDown": return this._host._primaryPane.priceScale.panByPixels(-20), !0;
				case "zoomIn": return s(1.1);
				case "zoomOut": return s(1 / 1.1);
				case "resetScale": return this._host.resetScale(), !0;
				case "fitContent": return this._host.fitContent(), !0;
				case "screenshot": return this._host.downloadScreenshot(), !0;
				case "toggleGridVert": return this._host.setGridOptions({ vertLines: !this._host._gridVert }), !0;
				case "toggleGridHorz": return this._host.setGridOptions({ horzLines: !this._host._gridHorz }), !0;
				case "toggleCrosshairMagnet": return this._host.applyOptions({ crosshairMode: "magnet" === this._host._crosshairMode ? "normal" : "magnet" }), !0;
				default: return !1;
			}
		}
		_setHover(e) {
			const t = e?.externalId ?? null, s = e?.hoverKey ?? t;
			if (this._host._container.style.cursor = this._dragging && "pointer" !== e?.cursor ? "grabbing" : e?.cursor ?? "", t === this._hoverId && s === this._hoverKey) return;
			const r = t !== this._hoverId, n = null !== e && "top" !== e.zOrder, o = n || this._hoverOnBase ? i.Light : i.Cursor;
			this._hoverId = t, this._hoverKey = s, this._hoverOnBase = n, this._host.invalidate((e) => e.invalidateGlobal(o)), r && this._host._emit("hover", { id: t });
		}
		_updateCursor(e, t, s, r, n) {
			const o = this._host._width - this._host._rightAxisWidth, a = t - this._host._leftAxisWidth, l = Math.max(0, o - this._host._leftAxisWidth);
			if (a < 0 || a > l) return void this._host._onPointerLeave();
			const h = this._host._panes[e], c = this._hitAt(e, t, s);
			if (null === c && null !== this._host._layout._dividerAt(r)) return this._setHover(null), void (this._host._container.style.cursor = "row-resize");
			this._setHover(c), this._host._feedTimeNav(e !== this._host._timeNavPane || this._brandingHit(e, t, s) ? null : {
				x: a,
				y: s
			});
			let d = s;
			const u = Math.round(this._host._timeScale.xToIndex(a));
			let _ = null;
			if (null !== this._host._firstDataId.value) {
				const t = j(this._host._dataLayer, this._host._firstDataId.value, u);
				if (void 0 !== t && (_ = t, "magnet" === this._host._crosshairMode && e === this._host._layout._firstPaneSlot())) {
					const e = function(e, t) {
						const i = [
							t.open,
							t.high,
							t.low,
							t.close
						];
						let s = i[0], r = Math.abs(e - s);
						for (let t = 1; t < i.length; t++) {
							const n = Math.abs(e - i[t]);
							n < r && (r = n, s = i[t]);
						}
						return s;
					}(h.yToPrice(s), _);
					d = h.priceToY(e);
				}
			}
			this._cursorPane = e, this._cursor = {
				x: a,
				y: d
			}, this._readoutTime = _?.time ?? null;
			for (const e of this._host._indicators) e.updateLegendValues(u);
			if (this._host.invalidate((e) => e.invalidateGlobal(i.Cursor)), this._crosshairCbs.size > 0 || this._host._bus.has("crosshair:move") || this._host._bus.has("crosshair:readout")) {
				const i = {
					time: this._host._dataLayer.indexToTime(u) ?? null,
					index: u,
					price: this._priceAt(e, s),
					bar: _,
					point: {
						x: t,
						y: r
					},
					paneIndex: e,
					pressed: this._pointers.size > 0,
					...Eo(n),
					...this._pointers.size > 0 ? { samples: this._dragSamples(n) } : {}
				};
				mn(this._crosshairCbs, i), this._host._emit("crosshair:readout", i), this._host._emit("crosshair:move", i);
			}
		}
		_patchNavigation(e) {
			const t = this._host._navigation.panEnabled, i = this._host._navigation.zoomEnabled;
			for (const t of ["panEnabled", "zoomEnabled"]) {
				const i = Object.getOwnPropertyDescriptor(e, t);
				i && "value" in i && "boolean" == typeof i.value && (this._host._navigation[t] = i.value);
			}
			const s = !1 !== t && !1 === this._host._navigation.panEnabled, r = !1 !== i && !1 === this._host._navigation.zoomEnabled;
			(s || r) && (this._host._motion._stopDisabled(s, r), (null !== this._pinch || s && this._dragging || r && ("price" === this._axisDrag || "time" === this._axisDrag)) && (this._navigationCancelled = !0, this._dragging = !1, this._axisDrag = null, this._axisDragScale = null, this._pinch = null, this._pointerMoved = !0, this._host._dragVelocity = 0, this._setHover(null))), t === this._host._navigation.panEnabled && i === this._host._navigation.zoomEnabled || this._syncNavigatorPolicy(), "horizontal" !== e.mousePan && "both" !== e.mousePan || (this._host._navigation.mousePan = e.mousePan);
			const n = e.defaultVisibleBars;
			"number" == typeof n && Number.isFinite(n) && n >= 0 && (this._host._navigation.defaultVisibleBars = Math.min(1e5, Math.floor(n)), void 0 === e.defaultBarSpacing && delete this._host._navigation.defaultBarSpacing);
			const o = e.defaultBarSpacing;
			"number" == typeof o && Number.isFinite(o) && o >= 0 && (0 === o ? delete this._host._navigation.defaultBarSpacing : this._host._navigation.defaultBarSpacing = o);
		}
		_navigationAllowed(e) {
			switch (e) {
				case "panLeftBar":
				case "panRightBar":
				case "panLeft":
				case "panRight":
				case "panLeftFast":
				case "panRightFast":
				case "panUp":
				case "panDown": return !1 !== this._host._navigation.panEnabled;
				case "zoomIn":
				case "zoomOut":
				case "resetScale":
				case "fitContent": return !1 !== this._host._navigation.zoomEnabled;
				default: return !0;
			}
		}
		_syncNavigatorPolicy() {
			if (null === this._host._timeNav) return;
			if (this._timeNavButtons.every((e) => null === e || this._navigationAllowed(e))) return void this._host._timeNav.setOptions({ buttons: [...this._timeNavButtons] });
			const e = [];
			let t = !1;
			for (const i of this._timeNavButtons) null !== i ? this._navigationAllowed(i) && (t && e.length > 0 && e.push(null), e.push(i), t = !1) : t = !0;
			this._host._timeNav.setOptions({ buttons: e });
		}
	};
	var Do = [
		"up",
		"down",
		"collapse",
		"maximize"
	];
	function Wo(e = [], t) {
		const i = e.filter((e) => !Do.includes(e));
		return t && i.splice(i.includes("close") ? i.indexOf("close") : i.length, 0, ...Do), i;
	}
	var qo = class {
		constructor(e) {
			Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_indicatorLegendToggle", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_indicatorLegendRow", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_legendOffset", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: {
					top: 6,
					left: 8
				}
			}), this._host = e;
		}
		_syncLegendPanes() {
			for (const e of this._host._legends) e.paneIndex = this._host._panes.findIndex((t) => t.hasPrimitive(e.legend));
			this._restackLegends();
		}
		_restackLegends() {
			const e = /* @__PURE__ */ new Map(), t = this._host._primitives._priceCornerIndex(), i = this._host._indicators.length, s = /* @__PURE__ */ new Map();
			for (const { legend: e, paneIndex: t } of this._host._legends) this._host._studyLegends.has(e) && !s.has(t) && s.set(t, e);
			const r = (e) => s.get(e.paneIndex) === e.legend && this._host._layout._collapsedShown(e.paneIndex), n = new Map(this._host._indicators.map((e) => [e.legend(), e.policy()]));
			let o = !1;
			for (const a of [...this._host._legends.filter(r), ...this._host._legends.filter((e) => !r(e))]) {
				let l = e.get(a.paneIndex) ?? 0;
				const h = this._host._studyLegends.has(a.legend), c = h && this._host._indicatorLegendCollapsed && !r(a);
				a.legend.setSuppressed(c || l > 0 && this._host._layout._collapsedShown(a.paneIndex)), i > 0 && a.paneIndex === t && h && !o && (this._indicatorLegendRow = l++, o = !0);
				const d = this._host._panes[a.paneIndex], u = this._host._collapsed.has(d);
				if (h) {
					const e = this._host._legendActions.get(a.legend), t = a.legend.options().actions, i = void 0 === e || e[1] !== t ? t ?? [] : e[0], r = n.get(a.legend), o = Wo(i.filter((e) => !("close" === e && !1 === r?.removable || "settings" === e && !1 === r?.configurable)), void 0 !== d && d !== this._host._primaryPane && s.get(a.paneIndex) === a.legend);
					a.legend.setOptions({
						row: l,
						collapsed: u,
						actions: o
					}), this._host._legendActions.set(a.legend, [i, o]);
				} else a.legend.setOptions({ row: l });
				e.set(a.paneIndex, l + (c || !1 === a.legend.options().visible ? 0 : 1));
			}
			if (o || (this._indicatorLegendRow = e.get(t) ?? 0), i > 0 && null === this._indicatorLegendToggle) this._indicatorLegendToggle = new zo(), this._host.addPrimitive(this._indicatorLegendToggle, { anchor: "primary-pane" });
			else if (0 === i && null !== this._indicatorLegendToggle) {
				const e = this._indicatorLegendToggle;
				this._indicatorLegendToggle = null, this._host.removePrimitive(e);
			}
			this._syncLegendOffsets();
		}
		_syncLegendOffsets() {
			const e = this._host._primitives._priceCornerIndex(), t = this._host._primaryIndex(), i = yi({ iconSize: this._host._legendIconSize }), s = this._legendOffset.top + this._indicatorLegendRow * i;
			let r = s;
			for (const t of this._host._legends) {
				const i = t.legend.options();
				this._host._studyLegends.has(t.legend) || t.paneIndex !== e || !1 === i.visible || (i.row ?? 0) >= this._indicatorLegendRow || (r = Math.max(r, (i.top ?? 6) + ((i.row ?? 0) + 1) * yi(i)));
			}
			for (const i of this._host._legends) {
				if (!this._host._studyLegends.has(i.legend)) continue;
				const n = i.paneIndex === e || i.paneIndex === t;
				i.legend.setOptions(n ? {
					top: this._legendOffset.top + (this._indicatorLegendToggle ? r - s : 0),
					left: this._legendOffset.left
				} : {
					top: 6,
					left: 8
				});
			}
			this._indicatorLegendToggle?.setOptions({
				count: this._host._indicators.length,
				collapsed: this._host._indicatorLegendCollapsed,
				left: this._legendOffset.left,
				top: r,
				height: i
			});
		}
		_handleLegendAction(e) {
			if (e === Fo) return this._host.setIndicatorLegendCollapsed(!this._host._indicatorLegendCollapsed), !0;
			const t = e.lastIndexOf("::");
			if (t < 0) return !1;
			const s = e.slice(t + 2);
			if (null !== this._host._timeNav && e.startsWith(`${this._host._timeNav.options().id}::`)) return this._host._runShortcut(s) && this._host.invalidate((e) => e.invalidateGlobal(i.Full)), !0;
			if ("row" === s && !e.startsWith("indicator:")) return !0;
			if (!e.startsWith("indicator:")) return !1;
			const r = e.slice(10, t);
			if ("row" === s) return !0;
			const n = this._host._indicators.find((e) => e.id === r);
			if (void 0 === n) return !1;
			const o = n.paneIndex;
			switch (s) {
				case "close": return this._host.removeIndicator(r), !0;
				case "hide": return n.setVisible(!n.visible()), !0;
				case "up": return this._host.movePane(o, -1), !0;
				case "down": return this._host.movePane(o, 1), !0;
				case "collapse": return this._host.setPaneCollapsed(o, !this._host.paneCollapsed(o)), !0;
				case "maximize": return this._host.maximizePane(o), !0;
				case "settings": return !1 !== n.policy().configurable && this._host._emit("indicatorSettings", {
					instanceId: r,
					indicatorId: n.indicatorId,
					paneIndex: o
				}), !0;
				case "source": return this._host._emit("indicatorSource", {
					instanceId: r,
					indicatorId: n.indicatorId,
					paneIndex: o
				}), !0;
				default: return !1;
			}
		}
		_indicatorLegendHit(e, t, i) {
			return null !== this._indicatorLegendToggle && !0 === this._host._panes[e]?.hasPrimitive(this._indicatorLegendToggle) && null !== this._indicatorLegendToggle.hitTest(t - this._host._leftAxisWidth, i);
		}
	};
	var Vo = class Vo {
		constructor(e) {
			Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_maximizedPane", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), this._host = e;
		}
		_mappedPane(e) {
			return this._host._ensureScaled(e), this._collapsedShown(e) ? null : this._host._panes[e] ?? null;
		}
		_ensurePane(e) {
			if (!Number.isSafeInteger(e) || e < 0) throw new RangeError("Invalid pane index");
			const t = [];
			for (; this._host._panes.length <= e;) this._addPane(0 === this._host._panes.length ? 1 : .32), t.push(this._host._panes.length - 1);
			if (0 !== t.length) {
				this._relayout(), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._primitives._rehomeAnchored();
				for (const e of t) this._host._emit("paneAdded", { paneIndex: e });
			}
		}
		_addPane(e = 1) {
			const t = new Bi(this._host._doc, this._host._newBackend());
			if (t.weight = e, 0 === this._host._panes.length) this._host._pricePanes.add(t), this._host._primaryPane = t;
			else for (const e of t.scales()) e.setOptions({ minPrecision: 2 });
			return t.priceScale.setPriceFormatter(this._host._priceFormatter), this._host._priceScaleOptions && t.priceScale.setOptions(this._host._scales._scalePatchFor(t, this._host._priceScaleOptions)), this._host._panes.push(t), this._host._container.appendChild(t.element), this._host._pixels._observeCanvases(t, !0), t;
		}
		_remeasure() {
			if (0 === this._host._panes.length) return;
			const e = this._host._container.clientWidth, t = this._host._container.clientHeight;
			e > 0 && t > 0 && (this._host.applySize(e, t), this._host._paintNow());
		}
		_relayout(e = !1) {
			this._measureAxisColumns(), e || (this._host._syncTimeNavPane(), this._host._legendStack._restackLegends());
			const t = this._host._pixelRatio();
			e || (this._host._layoutRatio = t);
			const i = this._paneLayout(), s = this._bottomPaneIndex();
			this._host._panes.forEach((r, n) => {
				const o = i[n].height;
				e ? r.setLayoutSize(this._host._width, o) : (r.element.style.display = this._layoutWeight(n) > 0 ? "" : "none", r.element.style.flex = `0 0 ${o}px`, r.resize(this._host._width, o, t)), r.setScaleHeights(Math.max(0, o - (n === s ? this._host._timeAxisHeight : 0)));
			}), e || this._syncSeparators(), this._host._timeScale.setWidth(Math.max(0, this._host._width - this._host._rightAxisWidth - this._host._leftAxisWidth));
		}
		_syncSeparators() {
			const e = this._ratioForLayout(), t = this._topPaneIndex();
			this._host._panes.forEach((i, s) => i.setSeparator(s === t ? null : this._host._theme.paneSeparator, e));
		}
		_ratioForLayout() {
			return this._host._layoutRatio > 0 ? this._host._layoutRatio : this._host._pixelRatio();
		}
		_recomputeAxisColumns() {
			const e = [
				this._host._leftAxisWidth,
				this._host._rightAxisWidth,
				this._host._axisColumnWidth
			];
			this._measureAxisColumns(), e[0] === this._host._leftAxisWidth && e[1] === this._host._rightAxisWidth && e[2] === this._host._axisColumnWidth || (this._relayout(), this._host.invalidate((e) => e.invalidateGlobal(i.Full)));
		}
		_measureAxisColumns() {
			let e = 0, t = 0;
			this._host._emptyPriceAxis = !this._host._panes.some((e) => e.series().length > 0 || e.primitives().some((t) => null !== e.primitiveScaleId(t)));
			for (const i of this._host._panes) {
				const s = i.visibleAxes(this._host._emptyPriceAxis);
				e = Math.max(e, s.filter((e) => "left" === e.side).length), t = Math.max(t, s.filter((e) => "right" === e.side).length);
			}
			this._host._axisColumnWidth = Math.max(0, Math.min(this._host._priceAxisWidth, this._host._width / (e + t + 1))), this._host._leftAxisWidth = e * this._host._axisColumnWidth, this._host._rightAxisWidth = t * this._host._axisColumnWidth;
		}
		_layoutWeight(e) {
			const t = this._host._panes[e];
			return void 0 === t ? 0 : null === this._maximizedPane ? t.weight : e === this._maximizedPane ? 1 : 0;
		}
		_topPaneIndex() {
			for (let e = 0; e < this._host._panes.length; e++) if (this._layoutWeight(e) > 0) return e;
			return 0;
		}
		_bottomPaneIndex(e = !1) {
			for (let t = this._host._panes.length - 1; t >= 0; t--) if (this._layoutWeight(t) > 0 && (!e || !this._collapsedShown(t))) return t;
			return this._host._panes.length - 1;
		}
		_collapsedShown(e) {
			return null === this._maximizedPane && this._host._collapsed.has(this._host._panes[e]);
		}
		_dividerAt(e) {
			const t = this._paneLayout(), i = (e) => this._layoutWeight(e) > 0 && !this._collapsedShown(e);
			for (let s = 0; s < t.length - 1; s++) {
				if (Math.abs(e - t[s].top - t[s].height) > Vo.DIVIDER_GRAB) continue;
				let r = s, n = s + 1;
				for (; r >= 0 && !i(r);) r--;
				for (; n < t.length && !i(n);) n++;
				if (r >= 0 && n < t.length) return [r, n];
			}
			return null;
		}
		removePane(e, t) {
			if (!Number.isInteger(e) || e < 0 || e >= this._host._panes.length || this._host._panes[e] === this._host._primaryPane) return !1;
			if (this._host._indicators.some((i) => i.paneIndex === e && !this._host._policyAllows(i, "removable", t))) return !1;
			if (this._host._eventPane === e) {
				const e = this._host._primaryIndex();
				null !== this._host._eventMarkers && (this._host.removePrimitive(this._host._eventMarkers), this._host._primitives._addPrimitive(e, this._host._eventMarkers), this._host._emit("events:change", void 0)), this._host._eventPane = e;
			}
			this._host._eventPane > e && (this._host._eventPane -= 1);
			for (let t = this._host._indicators.length - 1; t >= 0; t--) {
				if (this._host._indicators[t].paneIndex !== e) continue;
				const [i] = this._host._indicators.splice(t, 1);
				i.remove({ force: !0 });
			}
			const s = this._host._panes[e];
			for (const e of [...s.series()]) s.removeSeries(e), this._host._dataLayer.removeSeries(e.dataId), this._host._seriesProvenance.delete(e.dataId), this._host._firstDataId.value === e.dataId && (this._host._firstDataId.value = null);
			this._host._pixels._observeCanvases(s, !1), s.destroy(), this._host._panes.splice(e, 1), null !== this._maximizedPane && (this._maximizedPane === e ? this._maximizedPane = null : this._maximizedPane > e && (this._maximizedPane -= 1));
			for (const t of this._host._indicators) t.paneIndex > e && t.shiftPane(-1);
			return this._host._timeScale.setBaseIndex(this._host._dataLayer.baseIndex), this._recomputeAxisColumns(), this._relayout(), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._primitives._rehomeAnchored(), this._host._legendStack._syncLegendPanes(), this._remapSavedDrawings((t) => t === e ? null : t > e ? t - 1 : t), this._host._emit("paneRemoved", { paneIndex: e }), !0;
		}
		_remapSavedDrawings(e) {
			const t = this._host._drawingState, i = Array.isArray(t) ? t : Array.isArray(t?.drawings) ? t.drawings : null;
			if (null === i) return;
			const s = i.flatMap((t) => {
				const i = t?.paneIndex ?? 0;
				if ("object" != typeof t || null === t || !Number.isInteger(i)) return [t];
				const s = e(i);
				return null === s ? [] : s === i ? [t] : [{
					...t,
					paneIndex: s
				}];
			});
			this._host._drawingState = Array.isArray(t) ? s : {
				...t,
				drawings: s
			};
		}
		movePane(e, t) {
			const s = e + t;
			if (-1 !== t && 1 !== t || !Number.isInteger(e) || e < 0 || s < 0 || e >= this._host._panes.length || s >= this._host._panes.length) return !1;
			const r = this._host._panes;
			if (!this._host._movablePrimaryPane && (r[e] === this._host._primaryPane || r[s] === this._host._primaryPane)) return !1;
			this._remapSavedDrawings((t) => t === e ? s : t === s ? e : t), [r[e], r[s]] = [r[s], r[e]], this._host._eventPane === e ? this._host._eventPane = s : this._host._eventPane === s && (this._host._eventPane = e), null !== this._host._eventMarkers && this._host._emit("events:change", void 0), this._maximizedPane === e ? this._maximizedPane = s : this._maximizedPane === s && (this._maximizedPane = e);
			for (const i of this._host._indicators) i.paneIndex === e ? i.shiftPane(t) : i.paneIndex === s && i.shiftPane(-t);
			for (const e of r) this._host._container.appendChild(e.element);
			return this._relayout(), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._primitives._rehomeAnchored(), this._host._legendStack._syncLegendPanes(), this._host._emit("paneMoved", {
				from: e,
				to: s
			}), !0;
		}
		setPrimaryPaneIndex(e) {
			if (this._host._destroyed || !this._host._movablePrimaryPane || !Number.isInteger(e) || e < 0 || e >= this._host._panes.length) return !1;
			let t = this._host._primaryIndex();
			if (t === e) return !1;
			for (let i = 0; t !== e; i++) {
				if (i > 2 * this._host._panes.length || !this._host.movePane(t, e > t ? 1 : -1)) return !1;
				t = this._host._primaryIndex();
			}
			return !0;
		}
		_firstPaneSlot() {
			const e = null === this._host._firstPane ? -1 : this._host._panes.indexOf(this._host._firstPane);
			return e < 0 ? this._host._primaryIndex() : e;
		}
		maximizePane(e) {
			return !(!Number.isInteger(e) || e < 0 || e >= this._host._panes.length) && (this._maximizedPane = this._maximizedPane === e ? null : e, this._relayout(), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._primitives._rehomeAnchored(), this._host._emit("paneMaximized", { paneIndex: this._maximizedPane }), !0);
		}
		_holdsOnlyFurniture(e) {
			return e !== this._host._primaryPane && 0 === e.series().length && e.primitives().every((e) => e === this._host._timeNav || this._host._anchored.some((t) => t.primitive === e));
		}
		setPaneCollapsed(e, t) {
			const s = this._host._panes[e];
			if (!Number.isInteger(e) || void 0 === s || s === this._host._primaryPane || "boolean" != typeof t || this._host._collapsed.has(s) === t) return !1;
			t ? this._host._collapsed.add(s) : this._host._collapsed.delete(s);
			const r = t && this._maximizedPane === e;
			return r && (this._maximizedPane = null), this._relayout(), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._primitives._rehomeAnchored(), r && this._host._emit("paneMaximized", { paneIndex: null }), this._host._emit("paneCollapsed", {
				paneIndex: e,
				collapsed: t
			}), !0;
		}
		_paneLayout() {
			return function(e, t) {
				const i = e[e.length - 1];
				if (!(t > 0 && Number.isFinite(t) && void 0 !== i)) return e.map((e) => ({ ...e }));
				const s = i.top + i.height;
				let r = e[0].top;
				return e.map((i, n) => {
					const o = n === e.length - 1 ? s : Math.round((i.top + i.height) * t) / t, a = {
						top: r,
						height: Math.max(0, o - r)
					};
					return r = Math.max(r, o), a;
				});
			}(this._paneShares(), this._ratioForLayout());
		}
		_paneShares() {
			const e = this._bottomPaneIndex(), t = yi({ iconSize: this._host._legendIconSize }) + 12, i = this._host._panes.map((i, s) => this._collapsedShown(s) ? t + (s === e ? this._host._timeAxisHeight : 0) : 0);
			let s = 0, r = 0;
			i.forEach((e, t) => {
				s += e, e || (r += this._layoutWeight(t));
			});
			const n = s > this._host._height ? this._host._height / s : 1, o = Math.max(0, this._host._height - s);
			let a = 0;
			return i.map((e, t) => {
				const i = {
					top: a,
					height: e ? e * n : r > 0 ? o * this._layoutWeight(t) / r : 0
				};
				return a += i.height, i;
			});
		}
	};
	Object.defineProperty(Vo, "DIVIDER_GRAB", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: 4
	});
	var Ho = /* @__PURE__ */ new Map();
	function Go(e) {
		const t = Ho.get(e);
		if (void 0 === t) throw new Error(`openalgo-charts: unknown series transform "${e}"; import 'openalgo-charts/transform' first`);
		return t;
	}
	function Yo(e) {
		if ("open" in e) return e;
		if ("value" in e) {
			const t = e.value, i = {
				time: e.time,
				open: t,
				high: t,
				low: t,
				close: t
			};
			return void 0 !== e.color && (i.color = e.color), i;
		}
		return {
			time: e.time,
			open: NaN,
			high: NaN,
			low: NaN,
			close: NaN
		};
	}
	var Xo = (e) => void 0 === e.options ? { type: e.type } : {
		type: e.type,
		options: { ...e.options }
	};
	var Jo = null;
	var Zo = class {
		constructor(e) {
			Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_transforms", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), this._host = e;
		}
		_setSeriesType(e, t, s) {
			if (null === this._host.seriesType(e)) return !1;
			const r = this._host._seriesRecords.get(e), n = this._host._seriesOwners.get(e), o = je(t);
			if (r.type === t) return !1;
			const a = r.style.precision, l = { ...r.style };
			for (const e of Object.keys(n.inheritedStyle)) l[e] === n.inheritedStyle[e] && delete l[e];
			const h = {};
			for (const e of Object.keys(o.defaultStyle)) Object.prototype.hasOwnProperty.call(l, e) || Object.assign(h, { [e]: o.defaultStyle[e] });
			for (const e of Object.keys(r.style)) delete r.style[e];
			if (Object.assign(r.style, h, l), n.inheritedStyle = h, r.type = t, r.style.precision !== a) {
				const e = n.pane.scaleOf(r);
				this._applyPrecision(e, r.style.precision), void 0 === r.style.precision && this._applySeriesPriceFormat(e, n.priceFormat);
			}
			return this._host.invalidate((e) => e.invalidateGlobal(i.Full)), s && this._host._emit("objects:change", {}), !0;
		}
		_setSeriesTransform(e, t, i) {
			return null !== this._host.seriesType(e) && (null !== Jo ? Jo.set(this, e, t, i) : (null !== t && this._newTransform(t), !1));
		}
		_seriesTransform(e) {
			const t = null === this._host.seriesType(e) ? void 0 : this._transforms.get(this._host._seriesRecords.get(e).dataId)?.spec;
			return void 0 === t ? null : Xo(t);
		}
		_transformOf(e) {
			const t = this._transforms.get(e)?.spec;
			return void 0 === t ? void 0 : Xo(t);
		}
		_underlying(e) {
			const t = null === e ? void 0 : this._transforms.get(e)?.run;
			return void 0 === t ? null : {
				bars: t.source(),
				sourceIndex: t.sourceIndex()
			};
		}
		_newTransform(e) {
			const t = { ...e.options }, i = Go(e.type).create(t);
			return {
				spec: Object.keys(t).length > 0 ? {
					type: e.type,
					options: t
				} : { type: e.type },
				run: i
			};
		}
		_createSeries(e, t, s, r) {
			const n = void 0 === t.transform ? void 0 : this._newTransform(t.transform), o = t.paneIndex ?? this._host._primaryIndex();
			this._host._layout._ensurePane(o);
			const a = this._host._dataLayer.createSeries();
			void 0 !== n && this._transforms.set(a, n);
			const l = new Ji(a);
			this._host._seriesProvenance.set(a, l);
			const h = function(e, t, i, s = "right") {
				return {
					dataId: e,
					type: t,
					style: {
						...je(t).defaultStyle,
						...i
					},
					scaleId: s
				};
			}(a, e, t.style, t.priceScaleId ?? "right");
			s && je(e).isPriceSeries && this._host._scales._claimPricePane(this._host._panes[o]);
			const c = s && null === this._host._firstDataId.value && je(e).isPriceSeries;
			c && (this._host._firstDataId.value = a, this._host._firstPane = this._host._panes[o]), this._host._panes[o].addSeries(h), this._host._layout._recomputeAxisColumns();
			const d = { ...je(e).defaultStyle };
			for (const e of Object.keys(t.style ?? {})) delete d[e];
			const u = {
				pane: this._host._panes[o],
				priceFormat: t.priceFormat,
				inheritedStyle: d,
				indicatorOwned: !s
			}, _ = u.pane.scaleOf(h), p = !0 === r?.get(u.pane)?.has(h.scaleId);
			this._applySeriesPriceFormat(_, t.priceFormat, p), p || void 0 === h.style.precision || this._applyPrecision(_, h.style.precision);
			const f = {
				setData: (e, t) => {
					const i = this._transforms.get(a)?.run;
					i?.setData(e.map(Yo)), this._setData(a, i?.elements() ?? e.map(Yo), t, u);
				},
				prependData: (e) => this._prependData(a, e.map(Yo)),
				update: (e, t) => this._updateBar(a, Yo(e), t, u),
				getData: () => this._transforms.get(a)?.run.source().slice() ?? this._host._dataLayer.indexedBars(a).map((e) => e.bar),
				applyOptions: (e) => {
					for (const t of Object.keys(e)) delete u.inheritedStyle[t];
					Object.assign(h.style, e), "precision" in e && this._applyPrecision(u.pane.scaleOf(h), e.precision), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._primary?.record === h && this._host._emit("objects:change", {});
				},
				remove: () => {
					const e = this._host._primary?.record === h;
					u.pane.removeSeries(h), this._host._dataLayer.removeSeries(a), this._host._seriesProvenance.delete(a), this._transforms.delete(a), this._host._firstDataId.value === a && (this._host._firstDataId.value = null), this._host._primary?.record === h && (this._host._primary = null, u.pane.setSourceSeries(null)), u.indicatorOwned || this._host._studies._reconcileIndicatorRanges(), this._host._timeScale.setBaseIndex(this._host._dataLayer.baseIndex), this._host._layout._recomputeAxisColumns(), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), e && (this._host._emit("data:update", { kind: "reset" }), this._host._emit("objects:change", {}));
				},
				priceScale: () => u.pane.scaleOf(h),
				createMarkers: (e) => {
					const t = new er(a, e, () => u.pane.scaleOf(h));
					return this._host._primitives._addPrimitive(this._host._panes.indexOf(u.pane), t), t;
				}
			};
			var m, b;
			return this._host._seriesRecords.set(f, h), m = f, b = l, Zi.set(m, b), this._host._seriesOwners.set(f, u), u.indicatorOwned || this._host._studies._reconcileIndicatorRanges(), c && (this._host._primary = {
				api: f,
				record: h
			}, this._host._panes[o].setSourceSeries(h), void 0 !== this._host._sourceAbove && this._host._primitives._placeSource(), this._host._emit("objects:change", {})), f;
		}
		_applySeriesPriceFormat(e, t, i = !1) {
			if (t) if ("custom" === t.type) i || e.setPriceFormatter(t.formatter);
			else if ("volume" === t.type) i || e.setPriceFormatter(Gi);
			else if ("percent" === t.type) {
				const s = t.precision ?? 2;
				i || e.setPriceFormatter((e) => `${e.toFixed(s)}%`);
			} else {
				i || e.setPriceFormatter(this._host._priceFormatter);
				const s = t.minMove ?? (void 0 !== t.precision ? Math.pow(10, -t.precision) : void 0);
				void 0 !== s && e.setOptions({ minMove: s });
			}
		}
		_applyPrecision(e, t) {
			if (void 0 === t || !isFinite(t)) return void e.setPriceFormatter(this._host._priceFormatter);
			const i = o(Math.round(t), 0, 8);
			e.setPriceFormatter((e) => e.toFixed(i));
		}
		_sharedAxis() {
			const e = this._host._dataLayer, t = this._host._timeScale;
			return [
				e.length,
				e.indexToTime(0) ?? 0,
				e.indexToTime(e.baseIndex) ?? 0,
				t.visibleRange().to,
				t.barSpacing,
				t.width
			];
		}
		_invalidateWrite(e, t) {
			const s = this._sharedAxis(), r = [...e].map((e) => this._host._panes.indexOf(e));
			if (r.includes(-1) || s.some((e, i) => e !== t[i])) return void this._host.invalidate((e) => e.invalidateGlobal(i.Full));
			if (0 === r.length) return;
			const n = this._clockedPanes();
			this._host.invalidate((e) => {
				for (const t of r) e.invalidatePane(t, {
					level: i.Full,
					autoScale: !0
				});
				for (const t of n) e.invalidatePane(t, {
					level: i.Light,
					autoScale: !1
				});
			});
		}
		_clockedPanes() {
			const e = this._host._axisChrome, t = [];
			return !0 === e.barCountdown && this._host._panes.forEach((e, i) => {
				e.series().some((e) => !1 !== e.style.visible && je(e.type).isPriceSeries) && t.push(i);
			}), e.sessionClock && t.push(this._host._bottomPaneIndex()), t;
		}
		_updateBar(e, t, i, s) {
			Xi(i, !0);
			const r = this._transforms.get(e)?.run;
			if (void 0 !== r) return void Jo.tick(this, e, r, t, i, s);
			const n = this._sharedAxis(), o = this._host._dataLayer.seriesBars(e), a = o[o.length - 1]?.time, l = void 0 === a || t.time > a ? "append" : t.time === a ? "replace" : "correction", h = this._host._timeScale.rightOffset >= 0, c = this._host._dataLayer.update(e, t);
			this._host._seriesProvenance.get(e)?.record(l, Math.max(a ?? t.time, t.time), i), this._host._timeScale.setBaseIndex(this._host._dataLayer.baseIndex), "append" !== c || h || this._host._mutateTimeScale(() => this._host._timeScale.setRightOffset(this._host._timeScale.rightOffset - 1)), e === this._host._firstDataId.value && this._host._studies._invalidateIndicators(), this._invalidateWrite([s.pane], n), this._host._updateAccessibleSummary(), e === this._host._firstDataId.value && this._host._emit("data:update", {
				kind: "update",
				time: t.time
			});
		}
		_setData(e, t, s, r) {
			Xi(s);
			const n = this._sharedAxis();
			e === this._host._firstDataId.value && this._host._motion._stopNavigationMotion(), this._host._dataLayer.setSeriesData(e, t);
			const o = this._host._dataLayer.seriesBars(e);
			this._host._seriesProvenance.get(e)?.record("reset", o[o.length - 1]?.time, s), e === this._host._firstDataId.value && (this._host._studies._invalidateIndicators(), this._host._studies._flushIndicators()), this._host._timeScale.setBaseIndex(this._host._dataLayer.baseIndex), !this._host._hasFitContent && this._host._dataLayer.length > 0 && (this._host._timeScale.setWidth(Math.max(0, this._host._width - this._host._rightAxisWidth - this._host._leftAxisWidth)), this._host._hasFitContent = this._host._fitDefaultView()), r.indicatorOwned ? this._invalidateWrite([r.pane], n) : this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._updateAccessibleSummary(), e === this._host._firstDataId.value && this._host._emit("data:update", { kind: "reset" });
		}
		_prependData(e, t) {
			const s = this._transforms.get(e)?.run;
			s?.prepend(t), void 0 === s ? this._host._dataLayer.addBars(e, t) : this._host._dataLayer.setSeriesData(e, s.elements());
			const r = this._host._dataLayer.seriesBars(e);
			this._host._seriesProvenance.get(e)?.record("prepend", r[r.length - 1]?.time), this._host._timeScale.setBaseIndex(this._host._dataLayer.baseIndex), e === this._host._firstDataId.value && this._host._studies._invalidateIndicators(), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._updateAccessibleSummary(), e === this._host._firstDataId.value && this._host._emit("data:update", { kind: "prepend" });
		}
	};
	var Qo = class {
		constructor(e) {
			Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), this._host = e;
		}
		_scalePatchFor(e, t) {
			if (void 0 === t.minMove || this._host._pricePanes.has(e)) return t;
			const i = { ...t };
			return delete i.minMove, i.minPrecision = 2, i;
		}
		_claimPricePane(e) {
			if (this._host._pricePanes.has(e)) return;
			this._host._pricePanes.add(e);
			const t = this._host._priceScaleOptions?.minMove;
			for (const i of e.axisScales()) i.setOptions(void 0 !== t ? {
				minMove: t,
				minPrecision: 0
			} : { minPrecision: 0 });
		}
		priceAxisState(e, t) {
			const i = this._host._panes[e];
			if (void 0 === i || !L(t)) return null;
			const s = i.scaleFor(t), r = "left" === t ? "right" : "left";
			return {
				paneIndex: e,
				scaleId: t,
				side: "left" === i.axisPlacement(t).side ? "left" : "right",
				active: i.usesScale(t),
				autoFit: s.autoScale,
				inverted: s.options.inverted,
				mode: s.options.mode,
				scaled: s.scaled,
				lockRatio: i.ratioLocked(t),
				movable: ("right" === t || "left" === t) && this._canMovePriceAxis(e, t, r)
			};
		}
		_canMovePriceAxis(e, t, i) {
			const s = this._host._panes[e];
			if (!s || t === i || !s.usesScale(t) || s.usesScale(i)) return !1;
			for (const e of this._host._indicators) {
				const i = e.renderResources(), r = i.series.filter((e) => this._host._seriesOwners.get(e.api)?.pane === s), n = i.primitives.filter((e) => s.hasPrimitive(e.primitive) && null !== s.primitiveScaleId(e.primitive)), o = r.filter((e) => this._host._seriesRecords.get(e.api)?.scaleId === t), a = n.filter((e) => s.primitiveScaleId(e.primitive) === t);
				if (o.length || a.length) {
					if (o.some((e) => e.overlay) || a.some((e) => e.overlay)) return !1;
					if (r.some((e) => !e.overlay && this._host._seriesRecords.get(e.api)?.scaleId !== t) || n.some((e) => !e.overlay && s.primitiveScaleId(e.primitive) !== t)) return !1;
				}
			}
			return !0;
		}
		_ensureScaledFor(e, t) {
			const i = this._host._panes[e];
			void 0 === i || i.scaleFor(t).scaled || i.autoscale(this._host._renderContext(e));
		}
	};
	var ea = class {
		constructor(e) {
			Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_eventVisible", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: {}
			}), this._host = e;
		}
		setEvents(e, t) {
			const i = this._ensureEventMarkers();
			i.setEvents(e), this._host._events = i.events();
			const s = t ?? this._host._primaryIndex();
			s !== this._host._eventPane && (this._host.removePrimitive(i), this._addPrimitive(s, i)), this._host._eventPane = s, this._syncEvents();
		}
		_ensureEventMarkers() {
			return null === this._host._eventMarkers && (this._host._eventMarkers = new Qn(), this._host._eventPane = this._host._primaryIndex(), this._addPrimitive(this._host._eventPane, this._host._eventMarkers), this._host.on("click", (e) => {
				const t = e;
				if (!t.id || t.viaDrag || t.paneIndex !== this._host._eventPane) return;
				const i = this._host._eventMarkers?.detailsForHit(t.id);
				i && this._host._emit("event:click", {
					...i,
					point: {
						x: t.point.x,
						y: t.point.y + (this._host._paneLayout()[t.paneIndex]?.top ?? 0)
					},
					paneIndex: t.paneIndex
				});
			})), this._host._eventMarkers;
		}
		_syncEvents() {
			if (null === this._host._eventMarkers && 0 === this._host._events.length) return;
			const e = this._eventVisible;
			this._ensureEventMarkers().setEvents(this._host._events.filter((t) => !1 !== e[t.type])), this._host._emit("events:change", void 0);
		}
		seriesStack(e) {
			const t = this._host._panes[e];
			if (void 0 === t) return [];
			const i = this._stackOwners(t, e), s = [];
			for (const e of t.series()) {
				const t = i.get(e);
				void 0 === t || s.includes(t) || s.push(t);
			}
			return s;
		}
		moveInSeriesStack(e, t, s, r) {
			if (this._host.isDestroyed || e === t || "above" !== s && "below" !== s) return !1;
			const n = e.startsWith("indicator:") ? this._host._indicators.find((t) => "indicator:" + t.id === e) : void 0, o = "source:primary" === e && null !== this._host._primary ? this._host._seriesOwners.get(this._host._primary.api)?.pane : void 0, a = n ? n.paneIndex : o ? this._host._panes.indexOf(o) : -1, l = a < 0 ? [] : this._host.seriesStack(a);
			if (!l.includes(e) || !l.includes(t) || n && !this._host._policyAllows(n, "movable", r)) return !1;
			const h = l.filter((t) => t !== e);
			if (h.splice(h.indexOf(t) + ("above" === s ? 1 : 0), 0, e), h.every((e, t) => e === l[t])) return !1;
			const c = h.flatMap((e) => this._host._indicators.filter((t) => "indicator:" + t.id === e)), d = new Set(c);
			let u = 0;
			for (let e = 0; e < this._host._indicators.length; e++) d.has(this._host._indicators[e]) && (this._host._indicators[e] = c[u++]);
			const _ = h.indexOf("source:primary");
			return _ >= 0 && (this._host._sourceAbove = 0 === _ ? null : h[_ - 1].slice(10)), this._host._studies._reorderIndicatorResources(), this._host.invalidate((e) => e.invalidateGlobal(i.Full)), this._host._emit("objects:change", {}), !0;
		}
		setPrimitiveStackAbove(e, t) {
			const s = this._host._panes.findIndex((t) => t.hasPrimitive(e));
			return !(s < 0 || null !== t && "string" != typeof t) && (this._host._panes[s].primitiveStackAbove(e) === t || (this._host._panes[s].setPrimitiveStackAbove(e, t), this._host.invalidate((e) => e.invalidatePane(s, {
				level: i.Light,
				autoScale: !1
			}))), !0);
		}
		_stackOwners(e, t) {
			const i = /* @__PURE__ */ new Map();
			null !== this._host._primary && this._host._seriesOwners.get(this._host._primary.api)?.pane === e && i.set(this._host._primary.record, "source:primary");
			for (const s of this._host._indicators) if (s.paneIndex === t) for (const { api: t } of s.renderResources().series) {
				const r = this._host._seriesRecords.get(t);
				void 0 !== r && this._host._seriesOwners.get(t)?.pane === e && i.set(r, "indicator:" + s.id);
			}
			return i;
		}
		_stackSlot(e, t) {
			const i = this._host._panes[e];
			if (void 0 === i) return;
			const s = this._stackOwners(i, e);
			let r;
			for (const e of i.series()) s.get(e) === t && (r = e);
			return r;
		}
		_placeSource() {
			const e = this._host._sourceAbove, t = null === this._host._primary ? void 0 : this._host._seriesOwners.get(this._host._primary.api);
			if (void 0 === e || void 0 === t) return;
			const i = t.pane, s = this._host._panes.indexOf(i), r = this._host._primary.record, n = this._stackOwners(i, s);
			n.delete(r);
			const o = i.series(), a = o.indexOf(r), l = null === e ? void 0 : this._stackSlot(s, "indicator:" + e);
			void 0 === l && (this._host._sourceAbove = null);
			const h = void 0 === l ? -1 : o.indexOf(l), c = o.findIndex((e, t) => t > h && e !== r && n.has(e));
			a > h && (c < 0 || a < c) || i.moveSeries(r, void 0 === l ? o[c] : o[h + 1] ?? null);
		}
		_reanchorSource() {
			const e = null === this._host._primary ? void 0 : this._host._seriesOwners.get(this._host._primary.api)?.pane;
			if ("string" != typeof this._host._sourceAbove || void 0 === e) return;
			const t = this._host.seriesStack(this._host._panes.indexOf(e)), i = t.indexOf("source:primary");
			this._host._sourceAbove = i > 0 ? t[i - 1].slice(10) : null;
		}
		_anchorTarget(e) {
			return "chart-bottom" === e ? this._host._bottomPaneIndex(!0) : "primary-pane" === e ? this._priceCornerIndex() : this._host._layout._topPaneIndex();
		}
		_priceCornerIndex() {
			const e = this._host._primaryIndex();
			return this._host._layout._layoutWeight(e) > 0 ? e : this._host._layout._topPaneIndex();
		}
		_rehomeAnchored() {
			if (0 !== this._host._anchored.length) for (const e of this._host._anchored) {
				const t = this._anchorTarget(e.anchor), i = this._host._panes.findIndex((t) => t.hasPrimitive(e.primitive));
				if (i === t) continue;
				i >= 0 && this._host._panes[i].removePrimitive(e.primitive);
				const s = this._host._legends.findIndex((t) => t.legend === e.primitive);
				s >= 0 && this._host._legends.splice(s, 1), this._addPrimitive(t, e.primitive);
			}
		}
		_addPrimitive(e, t) {
			this._host._layout._ensurePane(e);
			if (this._host._panes[e].addPrimitive(t, { requestUpdate: () => {
				const e = this._host._panes.findIndex((e) => e.hasPrimitive(t)), s = "top" === t.zOrder() && null == this._host._panes[e]?.primitiveStackAbove(t);
				this._host.invalidate((t) => t.invalidatePane(e, {
					level: s ? i.Cursor : i.Light,
					autoScale: !1
				}));
			} }), t instanceof Oi) {
				if (this._host._legends.push({
					legend: t,
					paneIndex: e
				}), t.setOptions({ hasOpenInterest: this._host.hasOpenInterest }), Object.keys(this._host._statusLine).length > 0) {
					const e = t.options().statusLine;
					t.setOptions({ statusLine: {
						...this._host._statusLine,
						...e
					} });
				}
				void 0 !== this._host._legendIconSize && t.setOptions({ iconSize: this._host._legendIconSize }), this._host._legendStack._restackLegends();
			}
			this._host.invalidate((t) => t.invalidatePane(e, {
				level: i.Light,
				autoScale: !1
			}));
		}
		removePrimitive(e) {
			const t = this._host._anchored.findIndex((t) => t.primitive === e);
			t >= 0 && this._host._anchored.splice(t, 1);
			const s = this._host._legends.findIndex((t) => t.legend === e);
			s >= 0 && this._host._legends.splice(s, 1);
			for (let t = 0; t < this._host._panes.length; t++) if (this._host._panes[t].removePrimitive(e)) return s >= 0 && this._host._legendStack._restackLegends(), this._host._layout._recomputeAxisColumns(), void this._host.invalidate((e) => e.invalidatePane(t, {
				level: i.Light,
				autoScale: !1
			}));
		}
	};
	var ta = class {
		constructor(e, t, i, s, r) {
			Object.defineProperty(this, "id", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: e
			}), Object.defineProperty(this, "x0", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: t
			}), Object.defineProperty(this, "y0", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: i
			}), Object.defineProperty(this, "x1", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: s
			}), Object.defineProperty(this, "y1", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: r
			}), Object.defineProperty(this, "stops", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			});
		}
		addColorStop(e, t) {
			this.stops.push({
				offset: e,
				color: t
			});
		}
		toString() {
			return `url(#${this.id})`;
		}
	};
	var ia = 2 * Math.PI;
	function sa(e) {
		if (!Number.isFinite(e)) return "0";
		const t = 100 * e, i = Number.isFinite(t) ? Math.round(t) / 100 : e;
		return String(0 === i ? 0 : i);
	}
	function ra(e) {
		return e.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}
	function na(e) {
		return /[ .,:;'|!iIljtfr[\]()-]/.test(e) ? .3 : /[mwMW@%]/.test(e) ? .9 : /[A-Z]/.test(e) ? .68 : .55;
	}
	function oa(e) {
		const t = e.trim().split(/\s+/);
		let i = null, s = null, r = 10, n = 0;
		for (; n < t.length; n++) {
			const e = t[n], o = /^(\d+(?:\.\d+)?)(px|pt)(?:\/\S+)?$/.exec(e);
			if (null !== o) {
				r = parseFloat(o[1]) * ("pt" === o[2] ? 4 / 3 : 1), n++;
				break;
			}
			"italic" === e || "oblique" === e ? s = e : /^(\d{3}|bold|bolder|lighter)$/.test(e) && (i = e);
		}
		return {
			size: r,
			family: t.slice(n).join(" ") || "sans-serif",
			weight: i,
			style: s
		};
	}
	var aa = {
		top: "text-before-edge",
		hanging: "hanging",
		middle: "central",
		ideographic: "ideographic",
		bottom: "text-after-edge"
	};
	var la = {
		center: "middle",
		right: "end",
		end: "end"
	};
	var ha = class {
		constructor(e, t, i = {}) {
			Object.defineProperty(this, "width", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: e
			}), Object.defineProperty(this, "height", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: t
			}), Object.defineProperty(this, "fillStyle", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "#000"
			}), Object.defineProperty(this, "strokeStyle", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "#000"
			}), Object.defineProperty(this, "lineWidth", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 1
			}), Object.defineProperty(this, "lineCap", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "butt"
			}), Object.defineProperty(this, "lineJoin", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "miter"
			}), Object.defineProperty(this, "miterLimit", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 10
			}), Object.defineProperty(this, "globalAlpha", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 1
			}), Object.defineProperty(this, "font", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "10px sans-serif"
			}), Object.defineProperty(this, "textAlign", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "start"
			}), Object.defineProperty(this, "textBaseline", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "alphabetic"
			}), Object.defineProperty(this, "shadowColor", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "rgba(0, 0, 0, 0)"
			}), Object.defineProperty(this, "shadowBlur", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "shadowOffsetX", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "shadowOffsetY", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "globalCompositeOperation", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "source-over"
			}), Object.defineProperty(this, "imageSmoothingEnabled", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !0
			}), Object.defineProperty(this, "canvas", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "unsupported", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_out", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_frames", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_gradients", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_clips", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_rootOpen", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_path", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: ""
			}), Object.defineProperty(this, "_hasPoint", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_dash", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "lineDashOffset", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_ids", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_strict", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_background", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_fontCache", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), this._strict = !0 === i.strict, this._background = i.background;
		}
		asCanvasContext() {
			return this;
		}
		save() {
			this._frames.push({
				kind: "save",
				open: 0,
				state: this._snapshot()
			});
		}
		restore() {
			let e = this._frames.length - 1;
			for (; e >= 0 && "save" !== this._frames[e].kind;) e--;
			if (!(e < 0)) {
				if (e !== this._frames.length - 1 && this._strict) throw new Error("SvgContext: restore() reached across an open pushGroup()");
				this._closeTo(e);
			}
		}
		pushGroup(e, t = {}) {
			let i = "<g";
			for (const t in e) i += ` ${t}="${ra(String(e[t]))}"`;
			const { translate: s, clip: r } = t;
			if (void 0 !== s && (i += ` transform="translate(${sa(s.x)} ${sa(s.y)})"`), void 0 !== r) i += ` clip-path="url(#${this._clipId(`<rect x="${sa(r.x)}" y="${sa(r.y)}" width="${sa(r.width)}" height="${sa(r.height)}"/>`)})"`;
			this._out.push(i + ">"), this._frames.push({
				kind: "group",
				open: 1,
				state: null
			});
		}
		popGroup() {
			let e = this._frames.length - 1;
			for (; e >= 0 && "group" !== this._frames[e].kind;) e--;
			if (e < 0) {
				if (this._strict) throw new Error("SvgContext: popGroup() without a pushGroup()");
			} else {
				if (e !== this._frames.length - 1 && this._strict) throw new Error("SvgContext: popGroup() reached across an open save()");
				this._closeTo(e);
			}
		}
		translate(e, t) {
			0 === e && 0 === t || this._openGroup(`transform="translate(${sa(e)} ${sa(t)})"`);
		}
		scale(e, t) {
			1 === e && 1 === t || this._openGroup(`transform="scale(${sa(e)} ${sa(t)})"`);
		}
		rotate(e) {
			0 !== e && this._openGroup(`transform="rotate(${sa(180 * e / Math.PI)})"`);
		}
		setLineDash(e) {
			this._dash = e.slice();
		}
		getLineDash() {
			return this._dash.slice();
		}
		beginPath() {
			this._path = "", this._hasPoint = !1;
		}
		closePath() {
			"" !== this._path && (this._path += "Z");
		}
		moveTo(e, t) {
			this._path += `M${sa(e)} ${sa(t)}`, this._hasPoint = !0;
		}
		lineTo(e, t) {
			this._path += `${this._hasPoint ? "L" : "M"}${sa(e)} ${sa(t)}`, this._hasPoint = !0;
		}
		quadraticCurveTo(e, t, i, s) {
			this._hasPoint || this.moveTo(e, t), this._path += `Q${sa(e)} ${sa(t)} ${sa(i)} ${sa(s)}`;
		}
		bezierCurveTo(e, t, i, s, r, n) {
			this._hasPoint || this.moveTo(e, t), this._path += `C${sa(e)} ${sa(t)} ${sa(i)} ${sa(s)} ${sa(r)} ${sa(n)}`;
		}
		rect(e, t, i, s) {
			this._path += `M${sa(e)} ${sa(t)}h${sa(i)}v${sa(s)}h${sa(-i)}Z`, this._hasPoint = !0;
		}
		roundRect(e, t, i, s, r = 0) {
			const n = Array.isArray(r) ? r : [r];
			let [o, a, l, h] = [
				n[0] ?? 0,
				n[1] ?? n[0] ?? 0,
				n[2] ?? n[0] ?? 0,
				n[3] ?? n[1] ?? n[0] ?? 0
			];
			const c = Math.min(1, i / Math.max(1e-9, o + a, h + l), s / Math.max(1e-9, o + h, a + l));
			o *= c, a *= c, l *= c, h *= c;
			const d = (e, t, i) => e > 0 ? `A${sa(e)} ${sa(e)} 0 0 1 ${sa(t)} ${sa(i)}` : "";
			this._path += `M${sa(e + o)} ${sa(t)}H${sa(e + i - a)}${d(a, e + i, t + a)}V${sa(t + s - l)}${d(l, e + i - l, t + s)}H${sa(e + h)}${d(h, e, t + s - h)}V${sa(t + o)}${d(o, e + o, t)}Z`, this._hasPoint = !0;
		}
		arc(e, t, i, s, r, n = !1) {
			this.ellipse(e, t, i, i, 0, s, r, n);
		}
		ellipse(e, t, i, s, r, n, o, a = !1) {
			const l = Math.cos(r), h = Math.sin(r), c = (r) => {
				const n = i * Math.cos(r), o = s * Math.sin(r);
				return [e + n * l - o * h, t + n * h + o * l];
			};
			let d, u = !1;
			a ? (u = n - o >= ia, d = -((n - o) % ia + ia) % ia) : (u = o - n >= ia, d = ((o - n) % ia + ia) % ia);
			const [_, p] = c(n);
			this._path += `${this._hasPoint ? "L" : "M"}${sa(_)} ${sa(p)}`, this._hasPoint = !0;
			const f = sa(180 * r / Math.PI), m = (e, t, r) => {
				const [n, o] = c(e);
				this._path += `A${sa(i)} ${sa(s)} ${f} ${t ? 1 : 0} ${r ? 1 : 0} ${sa(n)} ${sa(o)}`;
			};
			if (u) {
				const e = a ? -Math.PI : Math.PI;
				m(n + e, !1, !a), m(n + 2 * e, !1, !a);
			} else 0 !== d && m(n + d, Math.abs(d) > Math.PI, d > 0);
		}
		fill(e, t) {
			if ("object" == typeof e) return void this._unsupported("fill(Path2D)");
			if ("" === this._path) return;
			const i = this._paint(this.fillStyle);
			null !== i && this._out.push(`<path d="${this._path}" fill="${i}"${"evenodd" === e ? " fill-rule=\"evenodd\"" : ""}${this._opacity()}/>`);
		}
		stroke(e) {
			if (void 0 !== e) return void this._unsupported("stroke(Path2D)");
			if ("" === this._path) return;
			const t = this._strokeAttrs();
			null !== t && this._out.push(`<path d="${this._path}" fill="none"${t}${this._opacity()}/>`);
		}
		clip(e) {
			if ("object" == typeof e) return void this._unsupported("clip(Path2D)");
			if ("" === this._path) return;
			const t = this._clipId(`<path d="${this._path}"${"evenodd" === e ? " clip-rule=\"evenodd\"" : ""}/>`);
			this._openGroup(`clip-path="url(#${t})"`);
		}
		fillRect(e, t, i, s) {
			const r = this._paint(this.fillStyle);
			null !== r && this._rect(e, t, i, s, ` fill="${r}"`);
		}
		strokeRect(e, t, i, s) {
			const r = this._strokeAttrs();
			null !== r && this._rect(e, t, i, s, ` fill="none"${r}`);
		}
		clearRect(e, t, i, s) {
			void 0 !== this._background && this._rect(e, t, i, s, ` fill="${ra(this._background)}"`);
		}
		fillText(e, t, i) {
			if ("" === e) return;
			const s = this._paint(this.fillStyle);
			if (null === s) return;
			const r = this._font();
			let n = ` font-family="${ra(r.family)}" font-size="${sa(r.size)}"`;
			null !== r.weight && (n += ` font-weight="${r.weight}"`), null !== r.style && (n += ` font-style="${r.style}"`);
			const o = la[this.textAlign];
			void 0 !== o && (n += ` text-anchor="${o}"`);
			const a = aa[this.textBaseline];
			void 0 !== a && (n += ` dominant-baseline="${a}"`), this._out.push(`<text x="${sa(t)}" y="${sa(i)}"${n} fill="${s}"${this._opacity()}>${ra(e)}</text>`);
		}
		measureText(e) {
			const t = this._font();
			let i = 0;
			for (const t of e) i += na(t);
			const s = null !== t.weight && ("bold" === t.weight || "bolder" === t.weight || parseInt(t.weight, 10) >= 600), r = i * t.size * (s ? 1.05 : 1);
			return {
				width: r,
				actualBoundingBoxLeft: 0,
				actualBoundingBoxRight: r,
				actualBoundingBoxAscent: .8 * t.size,
				actualBoundingBoxDescent: .2 * t.size,
				fontBoundingBoxAscent: .8 * t.size,
				fontBoundingBoxDescent: .2 * t.size
			};
		}
		createLinearGradient(e, t, i, s) {
			const r = new ta("g" + ++this._ids, e, t, i, s);
			return this._gradients.push(r), r;
		}
		drawImage(e, ...t) {
			const i = this._imageHref(e);
			if (null === i) return void this._unsupported("drawImage");
			const s = e, r = s.naturalWidth ?? ("number" == typeof s.width ? s.width : 0), n = s.naturalHeight ?? ("number" == typeof s.height ? s.height : 0), o = this._opacity();
			if (t.length >= 8) {
				const [e, s, a, l, h, c, d, u] = t;
				this._out.push(`<svg x="${sa(h)}" y="${sa(c)}" width="${sa(d)}" height="${sa(u)}" viewBox="${sa(e)} ${sa(s)} ${sa(a)} ${sa(l)}" preserveAspectRatio="none"><image href="${ra(i)}" width="${sa(r)}" height="${sa(n)}" preserveAspectRatio="none"${o}/></svg>`);
				return;
			}
			const [a, l] = t, h = t.length >= 4 ? t[2] : r, c = t.length >= 4 ? t[3] : n;
			this._out.push(`<image href="${ra(i)}" x="${sa(a)}" y="${sa(l)}" width="${sa(h)}" height="${sa(c)}" preserveAspectRatio="none"${o}/>`);
		}
		setTransform() {
			this._unsupported("setTransform");
		}
		resetTransform() {
			this._unsupported("resetTransform");
		}
		getTransform() {
			this._unsupported("getTransform");
		}
		createRadialGradient() {
			this._unsupported("createRadialGradient");
		}
		createConicGradient() {
			this._unsupported("createConicGradient");
		}
		createPattern() {
			return this._unsupported("createPattern"), null;
		}
		getImageData() {
			this._unsupported("getImageData");
		}
		putImageData() {
			this._unsupported("putImageData");
		}
		createImageData() {
			this._unsupported("createImageData");
		}
		strokeText() {
			this._unsupported("strokeText");
		}
		drawFocusIfNeeded() {
			this._unsupported("drawFocusIfNeeded");
		}
		isPointInPath() {
			return this._unsupported("isPointInPath"), !1;
		}
		isPointInStroke() {
			return this._unsupported("isPointInStroke"), !1;
		}
		toString() {
			const e = sa(this.width), t = sa(this.height);
			let i = "";
			for (const e of this._clips) i += e;
			for (const e of this._gradients) {
				i += `<linearGradient id="${e.id}" gradientUnits="userSpaceOnUse" x1="${sa(e.x0)}" y1="${sa(e.y0)}" x2="${sa(e.x1)}" y2="${sa(e.y1)}">`;
				for (const t of e.stops) i += `<stop offset="${sa(t.offset)}" stop-color="${ra(t.color)}"/>`;
				i += "</linearGradient>";
			}
			let s = "";
			for (let e = this._frames.length - 1; e >= 0; e--) s += "</g>".repeat(this._frames[e].open);
			return s += "</g>".repeat(this._rootOpen), `<svg xmlns="http://www.w3.org/2000/svg" width="${e}" height="${t}" viewBox="0 0 ${e} ${t}" xml:space="preserve">` + ("" === i ? "" : `<defs>${i}</defs>`) + this._out.join("") + s + "</svg>";
		}
		_snapshot() {
			return {
				fillStyle: this.fillStyle,
				strokeStyle: this.strokeStyle,
				lineWidth: this.lineWidth,
				lineCap: this.lineCap,
				lineJoin: this.lineJoin,
				miterLimit: this.miterLimit,
				globalAlpha: this.globalAlpha,
				font: this.font,
				textAlign: this.textAlign,
				textBaseline: this.textBaseline,
				dash: this._dash.slice(),
				dashOffset: this.lineDashOffset
			};
		}
		_apply(e) {
			this.fillStyle = e.fillStyle, this.strokeStyle = e.strokeStyle, this.lineWidth = e.lineWidth, this.lineCap = e.lineCap, this.lineJoin = e.lineJoin, this.miterLimit = e.miterLimit, this.globalAlpha = e.globalAlpha, this.font = e.font, this.textAlign = e.textAlign, this.textBaseline = e.textBaseline, this._dash = e.dash, this.lineDashOffset = e.dashOffset;
		}
		_closeTo(e) {
			for (; this._frames.length > e;) {
				const e = this._frames.pop();
				this._out.push("</g>".repeat(e.open)), null !== e.state && this._apply(e.state);
			}
		}
		_openGroup(e) {
			this._out.push(`<g ${e}>`);
			const t = this._frames[this._frames.length - 1];
			void 0 !== t ? t.open++ : this._rootOpen++;
		}
		_clipId(e) {
			const t = "c" + ++this._ids;
			return this._clips.push(`<clipPath id="${t}">${e}</clipPath>`), t;
		}
		_rect(e, t, i, s, r) {
			0 !== i && 0 !== s && (i < 0 && (e += i, i = -i), s < 0 && (t += s, s = -s), this._out.push(`<rect x="${sa(e)}" y="${sa(t)}" width="${sa(i)}" height="${sa(s)}"${r}${this._opacity()}/>`));
		}
		_paint(e) {
			return this.globalAlpha <= 0 ? null : "string" != typeof e ? e instanceof ta ? e.toString() : null : "transparent" === e ? null : ra(e);
		}
		_strokeAttrs() {
			if (!(this.lineWidth > 0)) return null;
			const e = this._paint(this.strokeStyle);
			if (null === e) return null;
			let t = ` stroke="${e}" stroke-width="${sa(this.lineWidth)}"`;
			return "butt" !== this.lineCap && (t += ` stroke-linecap="${this.lineCap}"`), "miter" !== this.lineJoin && (t += ` stroke-linejoin="${this.lineJoin}"`), this._dash.some((e) => e > 0) && (t += ` stroke-dasharray="${this._dash.map(sa).join(" ")}"`, 0 !== this.lineDashOffset && (t += ` stroke-dashoffset="${sa(this.lineDashOffset)}"`)), t;
		}
		_opacity() {
			return this.globalAlpha < 1 ? ` opacity="${sa(this.globalAlpha)}"` : "";
		}
		_font() {
			return null !== this._fontCache && this._fontCache.font === this.font || (this._fontCache = {
				font: this.font,
				parsed: oa(this.font)
			}), this._fontCache.parsed;
		}
		_imageHref(e) {
			const t = e;
			if ("string" == typeof t.src && "" !== t.src) return t.src;
			if ("function" == typeof t.toDataURL) try {
				return t.toDataURL.call(e);
			} catch {
				return null;
			}
			return null;
		}
		_unsupported(e) {
			if (this._strict) throw new Error(`SvgContext: ${e} has no SVG form and cannot be exported`);
			this.unsupported.includes(e) || this.unsupported.push(e);
		}
	};
	var ca = "600 {size}px system-ui, -apple-system, \"Segoe UI\", sans-serif";
	var da = class {
		constructor(e) {
			Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_opts", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), this._opts = {
				text: e.text,
				fontSize: e.fontSize ?? 64,
				opacity: e.opacity ?? .08,
				zOrder: e.zOrder ?? "bottom",
				id: e.id ?? "text-watermark",
				color: e.color,
				font: e.font
			};
		}
		zOrder() {
			return this._opts.zOrder;
		}
		attached(e) {
			this._host = e;
		}
		detached() {
			this._host = null;
		}
		autoscaleInfo() {
			return null;
		}
		hitTest() {
			return null;
		}
		setOptions(e) {
			this._opts = {
				...this._opts,
				...e
			}, this._host?.requestUpdate();
		}
		draw(e, t) {
			const i = this._opts;
			if ("" === i.text) return;
			const s = t.dpr, r = t.plotWidth * s, n = t.plotHeight * s;
			if (r <= 0 || n <= 0) return;
			e.save(), e.beginPath(), e.rect(0, 0, r, n), e.clip(), e.globalAlpha = i.opacity, e.fillStyle = i.color ?? "#9aa4b2", e.textAlign = "center", e.textBaseline = "middle";
			const o = Math.min(i.fontSize * s, .8 * n);
			e.font = (i.font ?? ca).replace("{size}", String(Math.round(o)));
			const l = e.measureText(i.text).width, h = .8 * r;
			if (l > h && l > 0) {
				const t = Math.max(.1, o * (h / l));
				e.font = (i.font ?? ca).replace("{size}", String(t));
			}
			e.fillText(i.text, r / 2, n / 2), e.restore();
		}
	};
	var ua = class {
		constructor(e) {
			Object.defineProperty(this, "_host", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_brandingOptions", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_watermark", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_watermarkOptions", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: {
					visible: !1,
					text: "",
					color: "#9aa4b2",
					opacity: .08,
					fontSize: 64
				}
			}), this._host = e;
		}
		setBranding(e) {
			null !== this._host._branding && this._host.removePrimitive(this._host._branding), this._host._branding = null, this._brandingOptions = !1 !== e && {
				position: "bottom-left",
				margin: 14,
				opacity: 1,
				padding: 8,
				label: "Chart by OpenAlgo",
				href: "https://openalgo.in",
				id: "chart-branding",
				...!0 === e ? {} : e
			}, !1 !== this._brandingOptions && ("object" == typeof this._brandingOptions.padding && (this._brandingOptions.padding = { ...this._brandingOptions.padding }), this._host._branding = new oo(this._brandingOptions), this._host.addPrimitive(this._host._branding, { anchor: "chart-bottom" })), this._host.invalidate((e) => e.invalidateGlobal(i.Light)), this._host._emit("branding:changed", this._host.brandingOptions());
		}
		setWatermarkOptions(e) {
			const t = "boolean" == typeof e ? { visible: e } : e;
			if (null === t || "object" != typeof t) return;
			const i = this._watermarkOptions;
			"boolean" == typeof t.visible && (i.visible = t.visible);
			for (const e of [
				"text",
				"color",
				"font",
				"id"
			]) "string" == typeof t[e] && (i[e] = t[e]);
			"number" == typeof t.opacity && Number.isFinite(t.opacity) && (i.opacity = Math.max(0, Math.min(1, t.opacity))), "number" == typeof t.fontSize && Number.isFinite(t.fontSize) && (i.fontSize = Math.max(10, Math.min(200, t.fontSize))), "bottom" !== t.zOrder && "normal" !== t.zOrder && "top" !== t.zOrder || (i.zOrder = t.zOrder), this._syncWatermark(), this._host._layoutChanged("setWatermarkOptions");
		}
		_syncWatermark() {
			const e = this._watermarkOptions;
			if (!e.visible) return null !== this._watermark && this._host.removePrimitive(this._watermark), void (this._watermark = null);
			const t = e.text?.trim() ? e.text : [this._host._dataContext?.symbol, this._host._dataContext?.interval].filter(Boolean).join(" ");
			null === this._watermark ? (this._watermark = new da({
				...e,
				text: t
			}), this._host.addPrimitive(this._watermark, { anchor: "primary-pane" })) : this._watermark.setOptions({
				...e,
				text: t
			}), this._host.invalidate((e) => e.invalidateGlobal(i.Light));
		}
		takeScreenshot() {
			const e = this._host._pixelRatio(), t = this._host._doc.createElement("canvas");
			t.width = Math.max(1, Math.round(this._host._width * e)), t.height = Math.max(1, Math.round(this._host._height * e));
			const i = t.getContext("2d");
			if (null === i) return t;
			i.fillStyle = this._host._theme.background, i.fillRect(0, 0, t.width, t.height);
			const s = this._host._paneLayout();
			for (let t = 0; t < this._host._panes.length; t++) {
				if (this._host._layout._layoutWeight(t) <= 0) continue;
				const r = Math.round((s[t]?.top ?? 0) * e);
				for (const e of [this._host._panes[t].base, this._host._panes[t].top]) e.element.width > 0 && e.element.height > 0 && i.drawImage(e.element, 0, r);
			}
			return t;
		}
		exportSVG(e) {
			if (void 0 !== e.dpr && 1 !== e.dpr) throw new RangeError("exportSVG: dpr must be 1, SVG has no device pixels");
			const t = Math.max(1, Math.round(e.width ?? this._host._width)), s = Math.max(1, Math.round(e.height ?? this._host._height)), r = !1 !== e.background, n = new ha(t, s, { background: r ? this._host._theme.background : void 0 }), o = n.asCanvasContext();
			this._host._studies._flushIndicators();
			const a = this._host._width, l = this._host._height, h = this._host._layoutRatio, c = t !== a || s !== l || 1 !== this._host._layout._ratioForLayout();
			this._host._layoutRatio = 1, c && (this._host._width = t, this._host._height = s, this._host._layout._relayout(!0));
			try {
				r && "transparent" !== this._host._theme.background && (n.fillStyle = this._host._theme.background, n.fillRect(0, 0, t, s));
				const e = this._host._paneLayout(), i = this._host._layout._topPaneIndex();
				for (let s = 0; s < this._host._panes.length; s++) {
					if (this._host._layout._layoutWeight(s) <= 0) continue;
					const a = this._host._panes[s], l = {
						...this._host._renderContext(s),
						dpr: 1,
						hoverId: null,
						hoverKey: null,
						dragId: null,
						paintBackground: r
					}, h = s === i, c = e[s].top + (h ? 0 : 1), d = e[s].height - (h ? 0 : 1);
					h || (n.fillStyle = this._host._theme.paneSeparator, n.fillRect(0, e[s].top, t, 1)), n.pushGroup({ "data-pane": s }, {
						translate: {
							x: 0,
							y: c
						},
						clip: {
							x: 0,
							y: 0,
							width: t,
							height: d
						}
					}), a.autoscale(l), a.paintBase(l, o), a.paintTop(null, l, o), n.popGroup();
				}
			} finally {
				this._host._layoutRatio = h, c && (this._host._width = a, this._host._height = l, this._host._layout._relayout(!0), this._host.invalidate((e) => e.invalidateGlobal(i.Full)));
			}
			return n.toString();
		}
		applyOptions(e) {
			this._host._withinLayoutChange(() => {
				e.theme && this._host.setTheme(e.theme), e.grid && this._host.setGridOptions(e.grid), e.canvas && this._host.setCanvasOptions(e.canvas), e.statusLine && this._host.setStatusLineOptions(e.statusLine), void 0 !== e.legendIconSize && this._host.setLegendIconSize(e.legendIconSize), e.priceScale && this._host.setPriceScaleOptions(e.priceScale), void 0 !== e.priceFormatter && this._host.setPriceFormatter(e.priceFormatter), "timeFormatter" in e && this._host.setTimeFormatter(e.timeFormatter), void 0 !== e.timezone && this._host.setTimezone(e.timezone), e.crosshairMode && (this._host._crosshairMode = e.crosshairMode), "boolean" == typeof e.crosshairSnapToBar && (this._host._crosshairSnapToBar = e.crosshairSnapToBar, this._host.invalidate((e) => e.invalidateGlobal(i.Cursor)));
			}), this._host._layoutChanged("applyOptions");
		}
	};
	var _a = class {
		constructor() {
			Object.defineProperty(this, "_listeners", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			});
		}
		on(e, t) {
			let i = this._listeners.get(e);
			return void 0 === i && (i = /* @__PURE__ */ new Set(), this._listeners.set(e, i)), i.add(t), () => this.off(e, t);
		}
		once(e, t) {
			const i = (s) => {
				this.off(e, i), t(s);
			};
			return this.on(e, i);
		}
		off(e, t) {
			void 0 === t ? this._listeners.delete(e) : this._listeners.get(e)?.delete(t);
		}
		emit(e, t) {
			mn(this._listeners.get(e), t);
		}
		has(e) {
			return (this._listeners.get(e)?.size ?? 0) > 0;
		}
		clear() {
			this._listeners.clear();
		}
	};
	function pa(e) {
		if (!_t(e)) throw new Error(`openalgo-charts: unknown IANA time zone "${e}"`);
		return e;
	}
	function fa() {
		return "undefined" != typeof window && window.devicePixelRatio ? window.devicePixelRatio : 1;
	}
	var ma = class {
		constructor(e, t = {}) {
			Object.defineProperty(this, "_container", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_doc", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_pixelRatio", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_theme", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_panes", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_primaryPane", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_loop", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_raf", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_rafInjected", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_remeasureHandle", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_dataLayer", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: new A()
			}), Object.defineProperty(this, "_timeScale", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_timeScaleMutationDepth", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_priceAxisWidth", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_timeAxisHeight", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_pending", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_framing", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_scaleMutationDepth", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_pixels", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: new Hi(this)
			}), Object.defineProperty(this, "_layoutRatio", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_width", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_height", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_hasFitContent", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_layoutDepth", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_crosshairMode", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_crosshairSnapToBar", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_priceOnlyAutoScale", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_indicatorLegendCollapsed", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_shortcuts", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_trading", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_tickSchedule", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_input", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: new $o(this)
			}), Object.defineProperty(this, "_now", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_conflate", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_conflationFactor", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_backendFactory", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_rendererKind", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_requestedRenderer", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_gridVert", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !0
			}), Object.defineProperty(this, "_gridHorz", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !0
			}), Object.defineProperty(this, "_canvas", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: {}
			}), Object.defineProperty(this, "_statusLine", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: {}
			}), Object.defineProperty(this, "_legendIconSize", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_axisChrome", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: {
					sessionClock: !1,
					barCountdown: !1
				}
			}), Object.defineProperty(this, "_sessionClockForm", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_wallClock", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: () => Date.now() / 1e3
			}), Object.defineProperty(this, "_tradingSettings", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: {}
			}), Object.defineProperty(this, "_events", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_eventMarkers", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_eventPane", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_primitives", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: new ea(this)
			}), Object.defineProperty(this, "_navigation", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: {
					mousePan: "both",
					defaultVisibleBars: 0,
					panEnabled: !0,
					zoomEnabled: !0
				}
			}), Object.defineProperty(this, "_liveRegion", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_lastDragX", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_lastDragT", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_dragVelocity", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_motion", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_animZoom", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_zoomAnchor", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_doubleClick", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_movablePrimaryPane", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_firstDataId", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: { value: null }
			}), Object.defineProperty(this, "_primary", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_seriesRecords", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new WeakMap()
			}), Object.defineProperty(this, "_seriesProvenance", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_indicators", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_sourceAbove", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_legendActions", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new WeakMap()
			}), Object.defineProperty(this, "_persistence", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: new po(this)
			}), Object.defineProperty(this, "_indicatorRanges", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_ownedScaleRanges", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_seriesOwners", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new WeakMap()
			}), Object.defineProperty(this, "_series", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: new Zo(this)
			}), Object.defineProperty(this, "_dataContext", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_barsProvider", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_barsRequests", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: new AbortController()
			}), Object.defineProperty(this, "_barsProviderRevision", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_requestedDataRevision", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_studies", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: new Lo(this, this)
			}), Object.defineProperty(this, "_indicatorsDirty", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_indicatorRefreshes", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Map()
			}), Object.defineProperty(this, "_indicatorReservedIds", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Set()
			}), Object.defineProperty(this, "_drawingState", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_alertState", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_layout", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: new Vo(this)
			}), Object.defineProperty(this, "_collapsed", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new WeakSet()
			}), Object.defineProperty(this, "_legends", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_studyLegends", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new Set()
			}), Object.defineProperty(this, "_legendStack", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: new qo(this)
			}), Object.defineProperty(this, "_firstPane", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_historyLoader", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_loadingHistory", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_priceFormatter", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_priceScaleOptions", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_pricePanes", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: /* @__PURE__ */ new WeakSet()
			}), Object.defineProperty(this, "_scales", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: new Qo(this)
			}), Object.defineProperty(this, "_timeFormatter", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "_timezone", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: ht
			}), Object.defineProperty(this, "_leftAxisWidth", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_rightAxisWidth", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_axisColumnWidth", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: 0
			}), Object.defineProperty(this, "_emptyPriceAxis", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !0
			}), Object.defineProperty(this, "_timeNav", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_schedulingTimeNav", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_timeNavPane", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: -1
			}), Object.defineProperty(this, "_branding", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: null
			}), Object.defineProperty(this, "_appearance", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: new ua(this)
			}), Object.defineProperty(this, "_bus", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: new _a()
			}), Object.defineProperty(this, "_anchored", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: []
			}), Object.defineProperty(this, "_onPixelRatio", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: () => this._pixels._onPixelRatio()
			}), Object.defineProperty(this, "_checkPixelRatio", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: () => this._pixels._checkPixelRatio()
			}), Object.defineProperty(this, "_onPointerEnter", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: () => this._input._onPointerEnter()
			}), Object.defineProperty(this, "_onContextMenu", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: (e) => this._input._onContextMenu(e)
			}), Object.defineProperty(this, "_onPointerDown", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: (e) => this._input._onPointerDown(e)
			}), Object.defineProperty(this, "_onPointerMove", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: (e) => this._input._onPointerMove(e)
			}), Object.defineProperty(this, "_onPointerUp", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: (e) => this._input._onPointerUp(e)
			}), Object.defineProperty(this, "_onPointerUpNative", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: (e) => this._input._onPointerUpNative(e)
			}), Object.defineProperty(this, "_onPointerCancel", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: (e) => this._input._onPointerCancel(e)
			}), Object.defineProperty(this, "_onLostPointerCapture", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: (e) => this._input._onLostPointerCapture(e)
			}), Object.defineProperty(this, "_onPointerLeave", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: () => this._input._onPointerLeave()
			}), Object.defineProperty(this, "_onWheel", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: (e) => this._input._onWheel(e)
			}), Object.defineProperty(this, "_onDblClick", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: (e) => this._input._onDblClick(e)
			}), Object.defineProperty(this, "_onKeyDown", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: (e) => this._input._onKeyDown(e)
			}), Object.defineProperty(this, "_destroyed", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), Object.defineProperty(this, "_destroying", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: !1
			}), this._timeScale = new x(t.timeScale), this._container = e, this._doc = t.document ?? e.ownerDocument, this._pixelRatio = t.pixelRatio ?? fa, this._theme = t.theme ?? Yi, this._priceAxisWidth = t.priceAxisWidth ?? 56, this._rightAxisWidth = this._priceAxisWidth, void 0 !== t.legendOffset?.top && (this._legendStack._legendOffset.top = t.legendOffset.top), void 0 !== t.legendOffset?.left && (this._legendStack._legendOffset.left = t.legendOffset.left), this._timeAxisHeight = t.timeAxisHeight ?? 22, this._crosshairMode = t.crosshairMode ?? "normal", this._crosshairSnapToBar = !0 === t.crosshairSnapToBar, this._priceOnlyAutoScale = !0 === t.priceOnlyAutoScale, this._indicatorLegendCollapsed = !0 === t.indicatorLegendCollapsed, Object.assign(this._axisChrome, t.axisChrome), "object" == typeof t.axisChrome?.sessionClock && (this._sessionClockForm = { ...t.axisChrome.sessionClock }), void 0 !== t.axisChrome?.clock && (this._wallClock = t.axisChrome.clock);
			const s = t.shortcuts;
			this._shortcuts = !1 === s ? null : s instanceof Nn ? s : new Nn(s ?? {}), this._now = t.now ?? (() => "undefined" != typeof performance ? performance.now() : 0), this._animZoom = t.animZoom ?? !0, this._barsProvider = t.barsProvider ?? null, this._motion = new Vi(this, t.animAutoscale ?? this._animZoom), this._zoomAnchor = t.zoomAnchor ?? "cursor", this._doubleClick = t.doubleClick ?? "reset", this._movablePrimaryPane = !0 === t.movablePrimaryPane, this._conflate = t.conflate ?? !0, this._conflationFactor = t.conflationFactor ?? 1, this._backendFactory = t.renderBackend ?? ji(t.renderer ?? "canvas2d"), this._requestedRenderer = void 0 === t.renderBackend ? t.renderer ?? "canvas2d" : null, this._priceFormatter = t.priceFormatter ?? null, this._priceScaleOptions = t.priceScale ?? null, this._timeFormatter = t.timeFormatter, void 0 !== t.timezone && (this._timezone = pa(t.timezone)), this._gridVert = t.grid?.vertLines ?? !0, this._gridHorz = t.grid?.horzLines ?? !0, Object.assign(this._canvas, t.canvas), t.grid && (this._canvas.grid = {
				...this._canvas.grid,
				...t.grid
			}), Object.assign(this._statusLine, t.statusLine), "number" == typeof t.legendIconSize && Number.isFinite(t.legendIconSize) && (this._legendIconSize = t.legendIconSize);
			const o = q(this._canvas.margins);
			void 0 === o.marginTop && void 0 === o.marginBottom || (this._priceScaleOptions = {
				...this._priceScaleOptions,
				...o
			}), this._input._patchNavigation(t.navigation ?? {});
			const a = t.timeNavigator ?? !0;
			if (!1 !== a) {
				const e = !0 === a ? void 0 : a;
				this._timeNav = new io({
					...e,
					hints: this._navHints(e)
				}, this._now), this._input._timeNavButtons = [...this._timeNav.options().buttons], this._input._syncNavigatorPolicy(), void 0 === e?.hints && null !== this._shortcuts && this.on("destroy", this._shortcuts.onChange(() => this._timeNav?.setOptions({ hints: this._navHints() })));
			}
			const l = "function" == typeof getComputedStyle ? getComputedStyle(e).position : e.style.position;
			l && "static" !== l || (e.style.position = "relative"), e.style.display = "flex", e.style.flexDirection = "column", e.style.background = this._theme.background, e.style.touchAction = "none", e.getAttribute("role") || e.setAttribute("role", "application"), e.setAttribute("aria-label", t.ariaLabel ?? "Interactive financial chart"), e.hasAttribute("tabindex") || (e.tabIndex = 0);
			const h = this._doc.createElement("div");
			h.setAttribute("aria-live", "polite");
			const c = h.style;
			var d;
			c.position = "absolute", c.width = "1px", c.height = "1px", c.overflow = "hidden", c.clip = "rect(0 0 0 0)", c.whiteSpace = "nowrap", c.border = "0", c.padding = "0", c.margin = "-1px", e.appendChild(h), this._liveRegion = h, this._raf = (d = t.raf) ? {
				schedule: d.schedule,
				cancel: d.cancel ?? r
			} : "function" == typeof requestAnimationFrame ? {
				schedule: (e) => requestAnimationFrame(e),
				cancel: (e) => cancelAnimationFrame(e)
			} : {
				schedule: (e) => setTimeout(e, 16),
				cancel: (e) => clearTimeout(e)
			}, this._rafInjected = void 0 !== t.raf, this._loop = new n(() => this._onFrame(), this._raf.schedule, this._raf.cancel), this._layout._addPane(), this.setBranding(t.branding ?? !0), this.setWatermarkOptions(t.watermark ?? !1), this._pixels._observeSize(), this._pixels._watchPixelRatio(), this._input._attachInput(), this._timeScale.setChangeHandler((e) => {
				if (this._timeScaleMutationDepth > 0 || this._destroyed) return;
				this._motion._stopNavigationMotion();
				const t = this._timeScale.visibleRange();
				t.from === e.from && t.to === e.to || (this.invalidate((e) => e.invalidateGlobal(i.Full)), this._emitViewportIfMoved(e));
			}), this.applySize(e.clientWidth, e.clientHeight), this._remeasureHandle = this._raf.schedule(() => {
				this._remeasureHandle = null, this._layout._remeasure();
			}), "function" == typeof queueMicrotask && queueMicrotask(() => this._emit("ready", {}));
		}
		setHistoryLoader(e) {
			this._historyLoader = e;
		}
		historyLoadComplete() {
			this._loadingHistory = !1;
		}
		get dataLayer() {
			return this._dataLayer;
		}
		setSessionCalendar(e) {
			this._destroyed || (this._dataLayer.setSessionCalendar(e), this.invalidate((e) => e.invalidateGlobal(i.Full)));
		}
		primaryBars() {
			const e = this._firstDataId.value;
			return null === e ? [] : this._dataLayer.seriesBars(e);
		}
		get timeScale() {
			return this._timeScale;
		}
		setVisibleLogicalRange(e) {
			this._motion._stopNavigationMotion(), this._timeScale.setVisibleLogicalRange(e);
		}
		getVisibleLogicalRange() {
			return this._timeScale.visibleRange();
		}
		fitContent() {
			this._motion._stopNavigationMotion(), this._dataLayer.length <= 0 || this._timeScale.fitContent(this._dataLayer.length);
		}
		navigationOptions() {
			return { ...this._navigation };
		}
		setNavigationOptions(e) {
			const t = this._navigation.defaultVisibleBars, i = this._navigation.defaultBarSpacing, s = this._navigation.panEnabled, r = this._navigation.zoomEnabled;
			this._input._patchNavigation(e), t === this._navigation.defaultVisibleBars && i === this._navigation.defaultBarSpacing || this.resetScale(), s === this._navigation.panEnabled && r === this._navigation.zoomEnabled || this._emit("objects:change", {}), this._layoutChanged("setNavigationOptions");
		}
		_fitDefaultView() {
			const e = this._dataLayer.length;
			return !(e <= 0) && this._timeScale.width > 0 && (this._mutateTimeScale(() => {
				if (this._timeScale.fitContent(e), void 0 !== this._navigation.defaultBarSpacing) this._timeScale.setBarSpacing(this._navigation.defaultBarSpacing);
				else if (this._navigation.defaultVisibleBars > 0) {
					const t = Math.min(e, this._navigation.defaultVisibleBars);
					this._timeScale.setBarSpacing(this._timeScale.width / (t + this._timeScale.rightOffset));
				}
			}), !0);
		}
		get shortcuts() {
			return this._shortcuts;
		}
		get trading() {
			return null === this._trading && (this._trading = new Vn(this), this._trading.setSettings(this._tradingSettings)), this._trading;
		}
		hasTrading() {
			return null !== this._trading;
		}
		tradingSettings() {
			if (null !== this._trading) return this._trading.getSettings();
			const e = { ...zn };
			for (const [t, i] of Object.entries(this._tradingSettings)) "string" == typeof i && (e[t.slice(0, -5)] = i);
			return e;
		}
		setTradingSettings(e) {
			Object.assign(this._tradingSettings, e), this._trading?.setSettings(e), this._layoutChanged("setTradingSettings");
		}
		_layoutChanged(e) {
			this._layoutDepth > 0 || this._destroyed || this._emit("layout:change", { setter: e });
		}
		_withinLayoutChange(e) {
			this._layoutDepth++;
			try {
				return e();
			} finally {
				this._layoutDepth--;
			}
		}
		addSeries(e, t = {}) {
			return this._series._createSeries(e, t, !0);
		}
		seriesType(e) {
			const t = this._seriesRecords.get(e), i = this._seriesOwners.get(e);
			return !this._destroyed && t && i && this._panes.includes(i.pane) && i.pane.series().includes(t) ? t.type : null;
		}
		seriesStyle(e) {
			return null === this.seriesType(e) ? null : Object.freeze({ ...this._seriesRecords.get(e).style });
		}
		setSeriesPriceScale(e, t) {
			if (!L(t) || null === this.seriesType(e)) return !1;
			const s = this._seriesRecords.get(e), r = this._seriesOwners.get(e);
			if (r.indicatorOwned || s.scaleId === t) return !1;
			const n = r.pane.scaleFor(t);
			return s.scaleId = t, this._studies._reconcileIndicatorRanges(), this._series._applySeriesPriceFormat(n, r.priceFormat), void 0 !== s.style.precision && this._series._applyPrecision(n, s.style.precision), this._layout._recomputeAxisColumns(), this.invalidate((e) => e.invalidateGlobal(i.Full)), this._emit("objects:change", {}), !0;
		}
		setSeriesType(e, t) {
			return this._series._setSeriesType(e, t, !0);
		}
		setSeriesTransform(e, t) {
			return this._series._setSeriesTransform(e, t, !0);
		}
		seriesTransform(e) {
			return this._series._seriesTransform(e);
		}
		primarySeries() {
			return this._primary?.api ?? null;
		}
		primarySeriesInfo() {
			const e = this._primary;
			return null === e ? null : {
				type: e.record.type,
				style: e.record.style
			};
		}
		addPriceLine(e, t) {
			const i = new Fn(e);
			return this._primitives._addPrimitive(t ?? this._primaryIndex(), i), i;
		}
		addEventMarkers(e, t = {}) {
			const i = new Qn(t);
			return this._primitives._addPrimitive(e ?? this._primaryIndex(), i), i;
		}
		setEvents(e, t) {
			this._primitives.setEvents(e, t);
		}
		eventMarkers() {
			return this._eventMarkers;
		}
		setEventMarkerOptions(e) {
			this._primitives._ensureEventMarkers().setOptions(e);
		}
		setEventGroups(e) {
			this._primitives._ensureEventMarkers().setGroups(e), this._emit("events:change", void 0);
		}
		setEventGroupVisible(e, t) {
			this._primitives._ensureEventMarkers().setGroupVisible(e, t), this._emit("events:change", void 0);
		}
		setEventOptions(e) {
			Object.assign(this._primitives._eventVisible, e), this._primitives._syncEvents(), this._layoutChanged("setEventOptions");
		}
		eventOptions() {
			return { ...this._primitives._eventVisible };
		}
		addIndicator(e, t = {}, i = {}) {
			return this._studies.addIndicator(e, t, i);
		}
		indicators() {
			return this._studies.indicators();
		}
		moveIndicator(e, t, i = {}) {
			return this._studies.moveIndicator(e, t, i);
		}
		reorderIndicator(e, t, i = {}) {
			return this._studies.reorderIndicator(e, t, i);
		}
		_policyAllows(e, t, i) {
			return !0 === i.force || !1 !== e.policy()[t];
		}
		seriesStack(e = this._primaryIndex()) {
			return this._primitives.seriesStack(e);
		}
		moveInSeriesStack(e, t, i, s = {}) {
			return this._primitives.moveInSeriesStack(e, t, i, s);
		}
		setPrimitiveStackAbove(e, t) {
			return this._primitives.setPrimitiveStackAbove(e, t);
		}
		removeIndicator(e, t = {}) {
			return this._studies.removeIndicator(e, t);
		}
		getDataContext() {
			return this._dataContext;
		}
		get hasOpenInterest() {
			return this._dataContext?.hasOpenInterest;
		}
		setDataContext(e) {
			const t = !function(e, t) {
				if (e === t) return !0;
				const i = e, s = t;
				for (const e of /* @__PURE__ */ new Set([...Object.keys(i ?? {}), ...Object.keys(s ?? {})])) if (i?.[e] !== s?.[e]) return !1;
				return !0;
			}(this._dataContext?.variant, e?.variant);
			if (this._dataContext?.symbol === e?.symbol && this._dataContext?.exchange === e?.exchange && this._dataContext?.hasOpenInterest === e?.hasOpenInterest && this._dataContext?.interval === e?.interval && !t && !!this._dataContext == !!e) return;
			const i = this._dataContext?.symbol !== e?.symbol || this._dataContext?.exchange !== e?.exchange, s = i || t || this._dataContext?.interval !== e?.interval;
			if (this._dataContext = e ? Object.freeze({ ...e }) : void 0, s && this._cancelBarsRequests(), s) for (const e of this._seriesProvenance.values()) e.contextChanged();
			this._indicators.length > 0 && (this._indicatorsDirty = !0, this._loop.requestFrame()), i && this._events.length && (this._events = [], this._primitives._syncEvents());
			for (const e of this._legends) e.legend.setOptions({ hasOpenInterest: this.hasOpenInterest });
			this._appearance._syncWatermark(), this._emit("data:context", this._dataContext);
		}
		setBarsProvider(e) {
			this._destroyed || this._destroying || e === this._barsProvider || (this._barsProvider = e, this._barsProviderRevision++, this._cancelBarsRequests(), this._emit("data:requests", {}));
		}
		_cancelBarsRequests() {
			if (this._destroying) return;
			const e = this._barsRequests;
			this._barsRequests = new AbortController(), e.abort();
		}
		invalidateRequestedData() {
			this._destroyed || this._destroying || (this._requestedDataRevision++, this._emit("data:requests", {}));
		}
		hasSnapshotProvider() {
			return "object" == typeof this._barsProvider && null !== this._barsProvider && "function" == typeof this._barsProvider.requestSnapshot;
		}
		hasBarsProvider() {
			return null !== this._barsProvider;
		}
		setBranding(e) {
			this._appearance.setBranding(e);
		}
		brandingOptions() {
			const e = this._appearance._brandingOptions;
			return !1 !== e && {
				...e,
				..."object" == typeof e.padding ? { padding: { ...e.padding } } : {}
			};
		}
		setWatermarkOptions(e) {
			this._appearance.setWatermarkOptions(e);
		}
		watermarkOptions() {
			return { ...this._appearance._watermarkOptions };
		}
		_indicatorHost(e) {
			return this._studies._indicatorHost(e);
		}
		subscribeClick(e) {
			return bn(this._input._clickCbs, e);
		}
		subscribeCrosshairMove(e) {
			return bn(this._input._crosshairCbs, e);
		}
		setLinkedCrosshairIndex(e) {
			if (this.isDestroyed || null !== this._cursor) return;
			const t = null === e ? null : this._dataLayer.indexToTime(e) ?? null;
			if (t === this._input._readoutTime) return;
			this._input._readoutTime = t;
			for (const t of this._indicators) t.updateLegendValues(e ?? void 0);
			const i = {
				source: "linked",
				time: t,
				index: e,
				bar: null === e || null === this._firstDataId.value ? null : j(this._dataLayer, this._firstDataId.value, e) ?? null,
				price: null,
				point: null,
				paneIndex: null
			};
			mn(this._input._crosshairCbs, i), this._emit("crosshair:readout", i);
		}
		_readoutIndex() {
			return null === this._input._readoutTime ? void 0 : this._dataLayer.timeToIndex(this._input._readoutTime);
		}
		subscribeDrag(e, t) {
			return bn(this._input._dragCbs, (i) => {
				i.end ? t?.(i.id, i.price, i.time) : e(i.id, i.price, i.time);
			});
		}
		_ensureScaled(e) {
			const t = this._panes[e];
			void 0 === t || t.readoutScale().scaled || t.autoscale(this._renderContext(e));
		}
		_xToTime(e) {
			return this._dataLayer.indexToTimeFloat(this._timeScale.xToIndex(e - this._leftAxisWidth));
		}
		timeToCoordinate(e) {
			return this._timeScale.indexToX(this._dataLayer.timeToIndexFloat(e)) + this._leftAxisWidth;
		}
		coordinateToTime(e) {
			return this._xToTime(e);
		}
		on(e, t) {
			return this._bus.on(e, t);
		}
		once(e, t) {
			return this._bus.once(e, t);
		}
		off(e, t) {
			this._bus.off(e, t);
		}
		emit(e, t) {
			this._bus.emit(e, t);
		}
		_emit(e, t) {
			this._bus.emit(e, t);
		}
		_mutateTimeScale(e) {
			this._timeScaleMutationDepth++;
			try {
				return e();
			} finally {
				this._timeScaleMutationDepth--;
			}
		}
		_emitViewport(e) {
			if (!this._bus.has(e)) return;
			const t = this._timeScale.visibleRange();
			this._emit(e, {
				from: this._dataLayer.indexToTime(Math.round(t.from)) ?? null,
				to: this._dataLayer.indexToTime(Math.round(t.to)) ?? null,
				logicalFrom: t.from,
				logicalTo: t.to
			});
		}
		_emitViewportIfMoved(e) {
			const t = this._timeScale.visibleRange();
			if (t.from === e.from && t.to === e.to) return;
			const i = Math.abs(t.to - t.from - (e.to - e.from)) > 1e-9;
			this._emitViewport(i ? "zoom" : "pan");
		}
		addPrimitive(e, t) {
			void 0 !== t && "number" != typeof t ? (this._anchored.push({
				primitive: e,
				anchor: t.anchor
			}), this._primitives._addPrimitive(this._primitives._anchorTarget(t.anchor), e)) : this._primitives._addPrimitive("number" == typeof t ? t : this._primaryIndex(), e);
		}
		priceToCoordinate(e, t = this._primaryIndex()) {
			const i = this._layout._mappedPane(t);
			return i && this._paneLayout()[t].top + i.priceToY(e);
		}
		coordinateToPrice(e, t = this._primaryIndex()) {
			const i = this._layout._mappedPane(t);
			return i && i.yToPrice(e - this._paneLayout()[t].top);
		}
		plotRect(e) {
			const t = this._destroyed || this._layout._collapsedShown(e) ? void 0 : this._paneLayout()[e];
			if (!t || !Number.isSafeInteger(e)) return null;
			this._ensureScaled(e);
			const i = this._width - this._leftAxisWidth - this._rightAxisWidth, s = t.height - (e === this._bottomPaneIndex() ? this._timeAxisHeight : 0);
			return i > 0 && s > 0 ? {
				left: this._leftAxisWidth,
				top: t.top,
				width: i,
				height: s
			} : null;
		}
		setGridOptions(e) {
			void 0 !== e.vertLines && (this._gridVert = e.vertLines), void 0 !== e.horzLines && (this._gridHorz = e.horzLines), this._canvas.grid = {
				...this._canvas.grid,
				...e
			}, this.invalidate((e) => e.invalidateGlobal(i.Full)), this._layoutChanged("setGridOptions");
		}
		gridOptions() {
			return {
				...this._canvas.grid,
				vertLines: this._gridVert,
				horzLines: this._gridHorz
			};
		}
		setCanvasOptions(e) {
			this._withinLayoutChange(() => {
				e.grid && this.setGridOptions(e.grid), e.crosshair && (this._canvas.crosshair = {
					...this._canvas.crosshair,
					...e.crosshair
				}), e.scales && (this._canvas.scales = {
					...this._canvas.scales,
					...e.scales
				}), e.margins && (this._canvas.margins = {
					...this._canvas.margins,
					...e.margins
				}, this.setPriceScaleOptions(q(this._canvas.margins), "axes"));
			}), this.invalidate((e) => e.invalidateGlobal(i.Full)), this._layoutChanged("setCanvasOptions");
		}
		canvasOptions() {
			return { ...this._canvas };
		}
		setPriceScaleOptions(e, t = "primary") {
			this._priceScaleOptions = {
				...this._priceScaleOptions,
				...e
			};
			for (const i of this._panes) {
				const s = "all" === t ? i.scales() : "axes" === t ? i.axisScales() : [i.priceScale], r = this._scales._scalePatchFor(i, e);
				for (const e of s) e.setOptions(r);
			}
			this.invalidate((e) => e.invalidateGlobal(i.Full)), this._layoutChanged("setPriceScaleOptions");
		}
		priceScaleDefaults() {
			return { ...this._priceScaleOptions };
		}
		priceScaleOptions() {
			return { ...this._primaryPane.priceScale.options };
		}
		setAutoScale(e) {
			for (const t of this._panes) for (const { scaleId: i } of t.visibleAxes(this._emptyPriceAxis)) e && t.setRatioLock(i, !1, 0, 0), t.scaleFor(i).setAutoScale(e);
			this.invalidate((e) => e.invalidateGlobal(i.Full)), this._layoutChanged("setAutoScale");
		}
		priceOnlyAutoScale() {
			return this._priceOnlyAutoScale;
		}
		setPriceOnlyAutoScale(e) {
			"boolean" == typeof e && e !== this._priceOnlyAutoScale && (this._priceOnlyAutoScale = e, this.invalidate((e) => e.invalidateGlobal(i.Full)), this._emit("objects:change", {}));
		}
		priceAxisState(e = this._primaryIndex(), t = "right") {
			return this._scales.priceAxisState(e, t);
		}
		priceAxisPlacement(e, t) {
			return L(t) ? this._priceAxisPane(e)?.axisPlacement(t) ?? null : null;
		}
		setPriceAxisPlacement(e, t, s, r) {
			const n = this._priceAxisPane(e);
			return !!(n && L(t) && n.setAxisPlacement(t, s, r)) && (this._layout._recomputeAxisColumns(), this.invalidate((e) => e.invalidateGlobal(i.Full)), this._emit("priceAxisPlacementChanged", {
				paneIndex: e,
				scaleId: t,
				...n.axisPlacement(t)
			}), this._emit("objects:change", {}), !0);
		}
		priceAxisLayout(e = this._primaryIndex()) {
			return this._priceAxisPane(e)?.axisSlots(this._renderContext(e)).map((e) => ({
				...e,
				x: e.x + this._leftAxisWidth
			})) ?? [];
		}
		_priceAxisPane(e) {
			return !this._destroyed && Number.isInteger(e) && e >= 0 ? this._panes[e] : void 0;
		}
		setPriceAxisOptions(e, t, s) {
			const r = this._panes[e];
			void 0 !== r && L(t) && (r.scaleFor(t).setOptions(s), this.invalidate((e) => e.invalidateGlobal(i.Full)), this._layoutChanged("setPriceAxisOptions"));
		}
		setPriceAxisAutoFit(e, t, s) {
			const r = this._panes[e];
			void 0 !== r && L(t) && (s && r.setRatioLock(t, !1, 0, 0), r.scaleFor(t).setAutoScale(s), this.invalidate((e) => e.invalidateGlobal(i.Full)), this._layoutChanged("setPriceAxisAutoFit"));
		}
		setPriceAxisLockRatio(e, t, s) {
			const r = this._panes[e];
			if (void 0 === r || !L(t)) return !1;
			s && this._scales._ensureScaledFor(e, t);
			const n = r.setRatioLock(t, s, this._timeScale.barSpacing, r.scaleFor(t).height);
			return this.invalidate((e) => e.invalidateGlobal(i.Full)), this._layoutChanged("setPriceAxisLockRatio"), n;
		}
		movePriceAxis(e, t, s) {
			const r = this._panes[e];
			if (!this._scales._canMovePriceAxis(e, t, s) || !r.moveSeriesScale(t, s)) return !1;
			for (const e of this._indicatorRanges.values()) e.pane === r && e.scaleId === t && (e.scaleId = s);
			for (const t of this._indicators) {
				if (t.paneIndex !== e) continue;
				const i = t.renderResources().series.filter((e) => !e.overlay), n = t.renderResources().primitives.filter((e) => !e.overlay && null !== r.primitiveScaleId(e.primitive));
				(i.length ? i.every((e) => this._seriesRecords.get(e.api)?.scaleId === s) : n.length && n.every((e) => r.primitiveScaleId(e.primitive) === s)) && t.adoptPriceScale(s);
			}
			const n = r.scaleFor(t);
			return this._priceScaleOptions && n.setOptions(this._scales._scalePatchFor(r, this._priceScaleOptions)), n.setPriceFormatter(this._priceFormatter), this._layout._recomputeAxisColumns(), this.invalidate((e) => e.invalidateGlobal(i.Full)), this._emit("priceAxisMoved", {
				paneIndex: e,
				from: t,
				to: s
			}), !0;
		}
		setStatusLineOptions(e) {
			Object.assign(this._statusLine, e);
			for (const e of this._legends) e.legend.setOptions({ statusLine: this._statusLine });
			this.invalidate((e) => e.invalidateGlobal(i.Full)), this._layoutChanged("setStatusLineOptions");
		}
		statusLineOptions() {
			return { ...this._statusLine };
		}
		indicatorLegendCollapsed() {
			return this._indicatorLegendCollapsed;
		}
		setIndicatorLegendCollapsed(e) {
			"boolean" == typeof e && e !== this._indicatorLegendCollapsed && (this._indicatorLegendCollapsed = e, this._legendStack._restackLegends(), this.invalidate((e) => e.invalidateGlobal(i.Cursor)), this._emit("objects:change", {}));
		}
		setLegendIconSize(e) {
			if (Number.isFinite(e)) {
				this._legendIconSize = e;
				for (const t of this._legends) t.legend.setOptions({ iconSize: e });
				this._layout._relayout(), this.invalidate((e) => e.invalidateGlobal(i.Full));
			}
		}
		legendIconSize() {
			return this._legendIconSize;
		}
		setAxisChromeOptions(e) {
			void 0 !== e.sessionClock && ("object" == typeof e.sessionClock && (this._sessionClockForm = { ...e.sessionClock }), this._axisChrome.sessionClock = !0 === e.sessionClock ? this._sessionClockForm ?? !0 : e.sessionClock), void 0 !== e.barCountdown && (this._axisChrome.barCountdown = e.barCountdown), void 0 !== e.clock && (this._axisChrome.clock = e.clock, this._wallClock = e.clock), this.invalidate((e) => e.invalidateGlobal(i.Full)), this._layoutChanged("setAxisChromeOptions");
		}
		axisChromeOptions() {
			return { ...this._axisChrome };
		}
		crosshairMode() {
			return this._crosshairMode;
		}
		crosshairSnapToBar() {
			return this._crosshairSnapToBar;
		}
		movablePrimaryPane() {
			return this._movablePrimaryPane;
		}
		theme() {
			return this._theme;
		}
		takeScreenshot() {
			return this._appearance.takeScreenshot();
		}
		exportSVG(e = {}) {
			return this._appearance.exportSVG(e);
		}
		removePrimitive(e) {
			this._primitives.removePrimitive(e);
		}
		tradeHost(e) {
			return {
				addPrimitive: (t) => this._primitives._addPrimitive(e ?? this._primaryIndex(), t),
				removePrimitive: (e) => this.removePrimitive(e)
			};
		}
		get rendererKind() {
			return this._rendererKind ?? "canvas2d";
		}
		get renderer() {
			return this.rendererKind;
		}
		_newBackend() {
			const e = this._backendFactory() ?? ji("canvas2d")();
			if (null === e) throw new Error("openalgo-charts: the canvas2d render backend factory returned null");
			return null === this._rendererKind && (this._rendererKind = e.kind, null !== this._requestedRenderer && "auto" !== this._requestedRenderer && e.kind !== this._requestedRenderer && console.warn(`openalgo-charts: render backend "${this._requestedRenderer}" is unavailable on this device; using "${e.kind}"`)), e;
		}
		_fallbackToCanvas2d(e) {
			const t = this.rendererKind;
			this._backendFactory = ji("canvas2d");
			for (const e of this._panes) e.setBackend(this._newBackend());
			this._rendererKind = "canvas2d";
			const s = {
				from: t,
				to: "canvas2d",
				reason: e
			};
			this._emit("renderer:fallback", s), this.invalidate((e) => e.invalidateGlobal(i.Full));
		}
		setPriceFormatter(e) {
			this._priceFormatter = e;
			for (const t of this._panes) t.priceScale.setPriceFormatter(e);
			for (const e of this._panes) for (const t of e.series()) void 0 !== t.style.precision && this._series._applyPrecision(e.scaleOf(t), t.style.precision);
			this.invalidate((e) => e.invalidateGlobal(i.Full));
		}
		setTimeFormatter(e) {
			this._timeFormatter = e, this.invalidate((e) => e.invalidateGlobal(i.Full));
		}
		timezone() {
			return this._timezone;
		}
		setTimezone(e) {
			const t = pa(e);
			t !== this._timezone && (this._timezone = t, this._studies._invalidateIndicators(), this.invalidate((e) => e.invalidateGlobal(i.Full)), this._emit("timezone:changed", { timezone: t }));
		}
		setPlacementMode(e) {
			this._input._placementMode = e, e && Un(this);
		}
		beginPick(e, t, i = {}) {
			if (this._destroyed || this._destroying) throw new Error("Cannot pick on a destroyed chart");
			if (this._input._placementMode) throw new Error("Finish drawing placement before picking a study value");
			if (!ts(i) || !is(i)) throw new TypeError("Invalid pick options");
			const s = Object.getOwnPropertyDescriptors(i), r = s.paneIndex?.value, n = s.priceScaleId?.value;
			if (void 0 !== r && (!Number.isSafeInteger(r) || r < 0 || !this._panes[r])) throw new RangeError("Invalid pick pane");
			const o = r ?? (void 0 !== n ? this._layout._firstPaneSlot() : void 0);
			if (!(void 0 === n || "time" !== e && L(n) && Object.prototype.hasOwnProperty.call(this._panes[o]?.scaleStates() ?? {}, n))) throw new RangeError("Invalid pick scale");
			return Yn(this, e, t, (t) => {
				const i = t, s = i?.point, r = i?.paneIndex;
				if (void 0 === r || !Number.isSafeInteger(r) || !s || !Number.isFinite(s.x) || !Number.isFinite(s.y) || i.viaDrag || void 0 !== i.id && null !== i.id || void 0 !== o && r !== o) return null;
				const a = this._panes[r], l = (this._paneLayout()[r]?.height ?? 0) - (r === this._bottomPaneIndex() ? this._timeAxisHeight : 0);
				if (!a || s.x < this._leftAxisWidth || s.x >= this._width - this._rightAxisWidth || s.y < 0 || s.y >= l) return null;
				if ("time" === e) return i.time ?? null;
				this._ensureScaled(r);
				const h = void 0 === n ? i.price ?? null : Object.prototype.hasOwnProperty.call(a.scaleStates(), n) ? a.scaleFor(n).yToPrice(s.y) : null;
				return "price" === e || null === h ? h : {
					time: i.time ?? NaN,
					price: h
				};
			});
		}
		setTheme(e) {
			this._theme = e, this._container.style.background = e.background, this._layout._syncSeparators(), this.invalidate((e) => e.invalidateGlobal(i.Full));
		}
		applyOptions(e) {
			this._appearance.applyOptions(e);
		}
		panes() {
			return this._panes;
		}
		getState() {
			return this._persistence.getState();
		}
		restoreState(e, t = {}) {
			return this._persistence.restoreState(e, t);
		}
		drawingState() {
			return this._drawingState;
		}
		setDrawingState(e) {
			this._drawingState = e, this._emit("objects:change", {});
		}
		snapPrice(e, t) {
			if (!Number.isFinite(t)) return t;
			if (null !== this._tickSchedule && e === this._primaryIndex()) return this._tickSchedule.round(t);
			const i = this._panes[e]?.priceScale.options.minMove ?? 0;
			return i > 0 ? l(t, i) : t;
		}
		tickSchedule() {
			return this._tickSchedule;
		}
		setTickSchedule(e) {
			const t = e;
			if (null != t && ("function" != typeof t.round || "function" != typeof t.step)) throw new TypeError("chart.setTickSchedule takes a schedule built with new TickSchedule(bands), or null");
			this._tickSchedule = e ?? null, this._trading?.setTickSchedule(this._tickSchedule);
		}
		alertState() {
			return void 0 === this._alertState ? void 0 : fn(this._alertState);
		}
		setAlertState(e) {
			if (void 0 !== e) {
				if (1 !== e.version) throw new Error("Unsupported alert document");
				for (const t of e.alerts) cn(t);
			}
			this._alertState = void 0 === e ? void 0 : {
				version: 1,
				alerts: e.alerts.map(dn)
			}, this._reserveAlertStudyIds(this._alertState, this._indicatorReservedIds);
		}
		_reserveAlertStudyIds(e, t) {
			for (const { source: i } of e?.alerts ?? []) "indicator" === i.kind ? t.add(i.instanceId) : "drawing" === i.kind && i.input && t.add(i.input.instanceId);
		}
		invalidate(e) {
			null === this._pending && (this._pending = new s()), e(this._pending), 0 !== this._scaleMutationDepth || this._framing || this._loop.requestFrame();
		}
		applySize(e, t) {
			e === this._width && t === this._height || (this._width = e, this._height = t, this._layout._relayout(), this._hasFitContent || (this._hasFitContent = this._fitDefaultView()), this.invalidate((e) => e.invalidateGlobal(i.Full)), this._emit("resize", {
				width: e,
				height: t
			}));
		}
		_bottomPaneIndex(e = !1) {
			return this._layout._bottomPaneIndex(e);
		}
		setPaneWeight(e, t) {
			const s = this._panes[e];
			void 0 !== s && Number.isFinite(t) && (s.weight = Math.max(.05, t), this._layout._relayout(), this.invalidate((e) => e.invalidateGlobal(i.Full)), this._layoutChanged("setPaneWeight"));
		}
		paneWeight(e) {
			return this._panes[e]?.weight ?? 0;
		}
		removePane(e, t = {}) {
			return this._layout.removePane(e, t);
		}
		movePane(e, t) {
			return this._layout.movePane(e, t);
		}
		primaryPaneIndex() {
			return this._primaryIndex();
		}
		setPrimaryPaneIndex(e) {
			return this._layout.setPrimaryPaneIndex(e);
		}
		_primaryIndex() {
			return Math.max(0, this._panes.indexOf(this._primaryPane));
		}
		maximizePane(e) {
			return this._layout.maximizePane(e);
		}
		maximizedPane() {
			return this._layout._maximizedPane;
		}
		setPaneCollapsed(e, t) {
			return this._layout.setPaneCollapsed(e, t);
		}
		paneCollapsed(e) {
			return this._collapsed.has(this._panes[e]);
		}
		_handleLegendAction(e) {
			return this._legendStack._handleLegendAction(e);
		}
		_paneLayout() {
			return this._layout._paneLayout();
		}
		_navHints(e) {
			if (void 0 !== e?.hints) return e.hints;
			if (null === this._shortcuts) return {};
			const t = {};
			for (const e of this._shortcuts.list()) {
				if ("zoomIn" !== e.command && "zoomOut" !== e.command && "resetScale" !== e.command) continue;
				const i = e.combos[0];
				void 0 !== i && (t[e.command] = ga(i));
			}
			return t;
		}
		_syncTimeNavPane() {
			const e = this._timeNav;
			if (null === e) return;
			const t = this._bottomPaneIndex(!0), i = this._panes.findIndex((t) => t.hasPrimitive(e));
			this._timeNavPane = t, t === i || t < 0 || (this._panes[i]?.removePrimitive(e), this._primitives._addPrimitive(t, e));
		}
		_feedTimeNav(e) {
			const t = this._timeNav;
			null !== t && (t.setPointer(e), t.animating() && this.invalidate((e) => e.invalidateGlobal(i.Light)));
		}
		_renderContext(e) {
			return {
				timeScale: this._timeScale,
				dataLayer: this._dataLayer,
				priceOnlyAutoScale: this._priceOnlyAutoScale,
				primaryDataId: this._primary?.record.dataId,
				dpr: this._pixelRatio(),
				priceAxisWidth: this._rightAxisWidth,
				axisColumnWidth: this._axisColumnWidth,
				emptyPriceAxis: this._emptyPriceAxis,
				timeAxisHeight: this._timeAxisHeight,
				showTimeAxis: e === this._bottomPaneIndex(),
				collapsed: this._layout._collapsedShown(e),
				conflate: this._conflate,
				conflationFactor: this._conflationFactor,
				theme: this._theme,
				showVertGrid: this._gridVert,
				showHorzGrid: this._gridHorz,
				canvasOptions: this._canvas,
				timeFormatter: this._timeFormatter,
				timezone: this._timezone,
				leftAxisWidth: this._leftAxisWidth,
				hoverId: this._input._hoverId,
				hoverKey: this._input._hoverKey,
				dragId: this._input._dragId,
				sessionClock: this._sessionClockOptions(),
				barCountdown: this._barCountdownOptions(),
				stackSlot: (t) => this._primitives._stackSlot(e, t)
			};
		}
		_sessionClockOptions() {
			const e = this._axisChrome.sessionClock;
			if (void 0 !== e && !1 !== e) return {
				visible: !0,
				now: this._wallClock,
				timezone: this._timezone,
				showOffset: !0 === e ? void 0 : e.showOffset
			};
		}
		_barCountdownOptions() {
			if (!0 !== this._axisChrome.barCountdown) return;
			const e = this._series._underlying(this._firstDataId.value)?.bars, t = void 0 === e ? this._dataLayer : {
				baseIndex: e.length - 1,
				indexToTime: (t) => e[t]?.time
			}, i = t.indexToTime(t.baseIndex);
			return void 0 !== i ? {
				visible: !0,
				now: this._wallClock,
				lastBarTime: i,
				intervalSec: ii(t)
			} : void 0;
		}
		_paintNow() {
			this._rafInjected || this._destroyed || this._destroying || null === this._pending || this._scaleMutationDepth > 0 || (this._loop.stop(), this._onFrame());
		}
		_onFrame() {
			if (this._destroyed || this._destroying) return;
			this._framing = !0;
			let e = !1;
			try {
				e = this._motion._step(), this._studies._flushIndicators();
			} finally {
				this._framing = !1;
			}
			const t = this._pending;
			this._pending = null;
			try {
				null === t || t.isEmpty() || this._paintFrame(t);
			} finally {
				e && !this._destroyed && this._loop.requestFrame();
			}
		}
		_paintFrame(e) {
			const t = e.globalLevel;
			let s = !1;
			const r = this._motion._autoscaleFraction();
			let n = this._cursor?.x ?? 0;
			const o = this._firstDataId.value ?? this._primaryPane.series()[0]?.dataId;
			if (null !== this._cursor && this._crosshairSnapToBar && void 0 !== o) {
				const e = Math.round(this._timeScale.xToIndex(n));
				void 0 !== j(this._dataLayer, o, e) && (n = this._timeScale.indexToX(e));
			}
			for (let o = 0; o < this._panes.length; o++) {
				const a = this._panes[o], l = e.paneInvalidation(o), h = Math.max(t, l?.level ?? i.None), c = this._renderContext(o);
				if ((h >= i.Full || l?.autoScale || null !== this._motion._autoscaleTime) && (s = a.autoscale(c, r) || s), h >= i.Light && a.paintBase(c), h >= i.Cursor && !this._input._overlayFrozen) {
					const e = null === this._cursor ? null : {
						x: n,
						yLocal: o === this._input._cursorPane ? this._cursor.y : null,
						showTimeTag: c.showTimeAxis
					};
					a.paintTop(e, c);
				}
			}
			s ? this.invalidate((e) => e.invalidateGlobal(i.Light)) : this._motion._autoscaleTime = null;
			const a = this._timeNav;
			if (a?.animating() && !this._schedulingTimeNav && (!this._input._overlayFrozen || "top" !== a.zOrder()) && this._panes[this._timeNavPane]?.primitives().includes(a)) {
				this._schedulingTimeNav = !0;
				try {
					this.invalidate((e) => e.invalidateGlobal(i.Light));
				} finally {
					this._schedulingTimeNav = !1;
				}
			}
			if (null !== this._rendererKind && "canvas2d" !== this._rendererKind) for (const e of this._panes) {
				const t = e.backendDegradation;
				if (null !== t) {
					this._fallbackToCanvas2d(t);
					break;
				}
			}
		}
		_runShortcut(e) {
			return this._input._runShortcut(e);
		}
		get _cursor() {
			return this._input._cursor;
		}
		resetScale() {
			this._motion._stopNavigationMotion();
			const e = this._timeScale.visibleRange();
			this._hasFitContent = this._fitDefaultView();
			for (const e of this._panes) {
				e.clearRatioLocks();
				for (const t of e.scales()) t.setAutoScale(!0);
			}
			this.invalidate((e) => e.invalidateGlobal(i.Full)), this._emitViewportIfMoved(e);
		}
		downloadScreenshot(e = "chart.png") {
			try {
				const t = this.takeScreenshot(), i = this._doc.createElement("a");
				i.href = t.toDataURL("image/png"), i.download = e, i.click();
			} catch {}
		}
		_updateAccessibleSummary() {
			if (null === this._liveRegion) return;
			const e = this._dataLayer.length;
			let t = `${e} bar${1 === e ? "" : "s"}`;
			if (null !== this._firstDataId.value && this._panes.includes(this._primaryPane)) {
				const e = this._dataLayer.lastIndexedBar(this._firstDataId.value);
				null !== e && (t += `, latest price ${this._primaryPane.priceScale.format(e.bar.close)}`);
			}
			this._liveRegion.textContent = `Financial chart, ${t}`;
		}
		_maybeLoadHistory() {
			if (null === this._historyLoader || this._loadingHistory) return;
			const e = this._timeScale.visibleRange();
			e.from < 10 && (this._loadingHistory = !0, this._emit("lazy-load", {
				from: this._dataLayer.indexToTime(Math.round(e.from)) ?? null,
				to: this._dataLayer.indexToTime(Math.round(e.to)) ?? null,
				direction: "backward"
			}), this._historyLoader());
		}
		_startKinetic(e) {
			this._motion._startKinetic(e);
		}
		get isDestroyed() {
			return this._destroyed;
		}
		destroy() {
			if (!this._destroyed && !this._destroying) {
				this._destroying = !0, this._barsRequests.abort(), this._timeScale.setChangeHandler(null), this._loop.stop(), null !== this._remeasureHandle && (this._raf.cancel(this._remeasureHandle), this._remeasureHandle = null), this._motion._stopNavigationMotion();
				for (const e of this._indicators.splice(0)) e.remove({ force: !0 });
				this._pixels._resizeObserver?.disconnect(), this._pixels._resizeObserver = null, this._pixels._deviceObserver?.disconnect(), this._pixels._deviceObserver = null, this._pixels._unwatchPixelRatio(), this._input._detachInput(), this._liveRegion?.remove(), this._liveRegion = null, this._container.style.cursor = "", this._input._pointers.clear();
				for (const e of this._panes) e.destroy();
				this._panes.length = 0, this._seriesProvenance.clear(), this._destroyed = !0, this._emit("destroy", {}), this._bus.clear();
			}
		}
	};
	function ba(e, t = {}) {
		return new ma(e, t);
	}
	function ga(e) {
		const t = {
			Equal: "+",
			Minus: "-",
			NumpadAdd: "+",
			NumpadSubtract: "-",
			ArrowLeft: "<",
			ArrowRight: ">",
			ArrowUp: "^",
			ArrowDown: "v"
		};
		return e.split("+").map((e) => e.trim()).map((e) => "Mod" === e ? wn() ? "Cmd" : "Ctrl" : t[e] ?? e.replace(/^(Key|Digit)/, "")).join(" + ");
	}
	Object.freeze([]);
	[
		..."precision priceLineVisible lastValueVisible colorByPreviousClose upColor downColor bodyVisible borderUpColor borderDownColor borderVisible wickUpColor wickDownColor wickVisible topColor bottomColor closeColor color lineWidth lineStyle areaTopColor areaBottomColor".split(" ").map((e) => `symbol.${e}`),
		..."titleMode title logo marketStatus chartValues barChange volume openInterest lastDayChange lastValueLabel background backgroundColor backgroundOpacity".split(" ").map((e) => `statusLine.${e}`),
		..."visible color opacity fontSize".split(" ").map((e) => `watermark.${e}`),
		..."mode autoScale priceOnly inverted".split(" ").map((e) => `scales.${e}`),
		..."grid.vertLines grid.vertColor grid.vertStyle grid.horzLines grid.horzColor grid.horzStyle grid.lineWidth grid.spacing crosshairMode crosshairSnapToBar crosshair.color crosshair.style crosshair.width scales.textColor scales.fontSize scales.lineColor margins.top margins.bottom".split(" ").map((e) => `canvas.${e}`)
	];
	[...Array.from({ length: 9 }, (e, t) => ({
		label: String(t),
		value: String(t)
	}))];
	var nl = {
		linear: "Linear",
		logarithmic: "Logarithmic",
		percentage: "Percent",
		"indexed-to-100": "Indexed to 100"
	};
	m.map((e) => ({
		label: nl[e],
		value: e
	}));
	//#endregion
	exports.Baseline = OrderWallsPrimitive;
	exports.Candidate = OrderWallsPrimitive$1;
	exports.createChart = ba;
	return exports;
})({});

//# sourceMappingURL=primitive.js.map