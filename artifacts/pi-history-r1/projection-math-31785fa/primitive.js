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
	//#region ../../../../tmp/iq-wall-math-IMthfR/baseline.ts
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
			paintStyleVisits: 0
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
	var PROJECTION_TIME_CACHE_LIMIT = 2048;
	/** The chart data layer preserves sub-candle event times as fractional logical indices. */
	function wallTimestampToLogical(timeMs, timeToIndexFloat) {
		if (!Number.isFinite(timeMs)) return null;
		const logical = timeToIndexFloat(timeMs / 1e3);
		return Number.isFinite(logical) ? logical : null;
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
			lastProjectionTimeTransforms: 0,
			lastProjectionTimeCacheHits: 0,
			lastProjectionPriceTransforms: 0,
			projectionCachePeak: 0,
			referenceRebuilds: 0,
			referenceSegments: 0,
			referenceValueScans: 0,
			paintCacheHits: 0,
			paintCacheBuilds: 0,
			paintStyleVisits: 0
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
			const frame = {
				from: rc.dataLayer.indexToTimeFloat(range.from) * 1e3,
				to: rc.dataLayer.indexToTimeFloat(range.to) * 1e3,
				width: this.width(),
				timeX: /* @__PURE__ */ new Map(),
				transforms: 0,
				hits: 0,
				prices: 0,
				peak: 0
			};
			if (this.dirty.size) {
				for (const id of this.dirty) {
					if (this.settings.visibleRangeOnly) this.markReference(id);
					this.removeDrawables(id);
					const segment = this.segments.get(id);
					if (segment) this.projectAll(segment, rc, frame);
					this.stats.patchProjects++;
				}
				this.dirty.clear();
			}
			if (this.tailDirty.size) {
				for (const [id, index] of this.tailDirty) {
					if (this.settings.visibleRangeOnly) this.markReference(id);
					const segment = this.segments.get(id);
					if (segment) this.projectTail(segment, index, rc, frame);
					this.stats.patchProjects++;
				}
				this.tailDirty.clear();
			}
			this.stats.lastProjectionTimeTransforms = frame.transforms;
			this.stats.lastProjectionTimeCacheHits = frame.hits;
			this.stats.lastProjectionPriceTransforms = frame.prices;
			this.stats.projectionCachePeak = Math.max(this.stats.projectionCachePeak, frame.peak);
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
		priceProjection(segment, rc, frame) {
			if (!this.settings.showHistory && segment.end !== null || segment.durationMs < this.settings.minDurationMs) return;
			const low = segment.price, high = low + frame.width, y = rc.priceScale.priceToY(this.settings.aggregation === "native" ? low : (low + high) / 2);
			frame.prices++;
			if (!Number.isFinite(y) || y < 0 || y > rc.plotHeight) return;
			return {
				low,
				high,
				y,
				from: segment.start + this.settings.minDurationMs,
				end: this.segmentTo(segment)
			};
		}
		timeX(time, rc, frame) {
			const cached = frame.timeX.get(time);
			if (cached !== void 0) {
				frame.hits++;
				return cached;
			}
			const logical = wallTimestampToLogical(time, (t) => rc.dataLayer.timeToIndexFloat(t));
			const value = logical === null ? NaN : rc.timeScale.indexToX(logical);
			frame.transforms++;
			if (frame.timeX.size >= PROJECTION_TIME_CACHE_LIMIT) frame.timeX.clear();
			frame.timeX.set(time, value);
			frame.peak = Math.max(frame.peak, frame.timeX.size);
			return value;
		}
		projectAll(segment, rc, frame) {
			const price = this.priceProjection(segment, rc, frame);
			if (!price) return;
			if (segment.detectionMode === "top-levels" && segment.valueRunsTruncated && segment.valueRuns.length > 0 && segment.valueRuns[0].at > segment.start) {
				const line = this.project(segment, -1, segment.start, segment.valueRuns[0].at, null, rc, frame, price);
				if (line) {
					this.paintInvalid = true;
					this.drawable.set(line.key, line);
					this.drawableKeys.set(segment.id, [line.key]);
				}
			}
			if (segment.valueRuns.length) {
				const first = Math.max(0, lowerBoundRun(segment.valueRuns, frame.from) - 1);
				const afterLast = Math.min(segment.valueRuns.length, Math.max(first + 1, upperBoundRun(segment.valueRuns, frame.to)));
				for (let index = first; index < afterLast; index++) this.projectIndex(segment, index, rc, frame, price);
				return;
			}
			const line = this.project(segment, 0, segment.start, price.end, null, rc, frame, price);
			if (line) {
				this.paintInvalid = true;
				this.drawable.set(line.key, line);
				this.drawableKeys.set(segment.id, [line.key]);
			}
		}
		projectTail(segment, fromIndex, rc, frame) {
			if (!segment.valueRuns.length) {
				this.removeDrawables(segment.id);
				this.projectAll(segment, rc, frame);
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
			const price = this.priceProjection(segment, rc, frame);
			if (!price) return;
			for (let i = fromIndex; i < segment.valueRuns.length; i++) this.projectIndex(segment, i, rc, frame, price);
		}
		removeDrawables(id) {
			const keys = this.drawableKeys.get(id) ?? [];
			if (keys.length) this.paintInvalid = true;
			for (const key of keys) this.drawable.delete(key);
			this.drawableKeys.delete(id);
		}
		projectIndex(segment, index, rc, frame, price) {
			const value = segment.valueRuns[index];
			if (!value) return;
			const next = segment.valueRuns[index + 1], from = value.at, to = Math.min(next?.at ?? price.end, price.end);
			const line = this.project(segment, index, from, to, value.percentile, rc, frame, price);
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
		project(segment, runIndex, from, to, percentile, rc, frame, price) {
			from = Math.max(from, price.from);
			if (to < from || to === from && segment.currentSelection !== true) return null;
			if (to < frame.from || from > frame.to) return null;
			const { low, high, y } = price, x = this.timeX(from, rc, frame), right = this.timeX(to, rc, frame);
			if (!Number.isFinite(x) || !Number.isFinite(right) || right < 0 || x > rc.plotWidth) return null;
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
	exports.Baseline = OrderWallsPrimitive;
	exports.Candidate = OrderWallsPrimitive$1;
	return exports;
})({});

//# sourceMappingURL=primitive.js.map