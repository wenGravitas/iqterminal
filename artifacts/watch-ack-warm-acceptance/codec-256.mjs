//#region src/feed/history-task-yield.ts
function yieldHistoryTask$1(signal, priority = "background", callback = () => {}) {
	if (signal?.aborted) return Promise.reject(signal.reason);
	const scheduler = globalThis.scheduler;
	if (typeof scheduler?.postTask === "function") return scheduler.postTask(callback, {
		priority,
		...signal ? { signal } : {}
	});
	return new Promise((resolve, reject) => {
		const cancel = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", cancel);
			reject(signal?.reason);
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", cancel);
			try {
				resolve(callback());
			} catch (error) {
				reject(error);
			}
		}, 0);
		signal?.addEventListener("abort", cancel, { once: true });
	});
}
//#endregion
//#region src/feed/compact-wall-presentation.ts
const MAX_DECODED = 67108864;
const MAX_ENCODED = 16777216;
const MAX_PART = 1048576;
const TARGET = 262144;
const hashImpl = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (v) => v.toString(16).padStart(2, "0")).join("");
const integer = (n) => Number.isSafeInteger(n) && Number(n) >= 0;
async function transformImpl(bytes, compress, max, signal) {
	signal.throwIfAborted();
	const setupAt = performance.now();
	const stream = new Blob([bytes]).stream().pipeThrough(compress ? new CompressionStream("gzip") : new DecompressionStream("gzip"));
	metrics.setupMs = (metrics.setupMs ?? 0) + performance.now() - setupAt;
	const reader = stream.getReader(), parts = [];
	let size = 0;
	const cancel = () => {
		reader.cancel(signal.reason).catch(() => {});
	};
	signal.addEventListener("abort", cancel, { once: true });
	try {
		for (;;) {
			signal.throwIfAborted();
			const { value, done } = await reader.read();
			signal.throwIfAborted();
			if (done) break;
			size += value.byteLength;
			if (size > max) throw Error("Compact wall cache byte capacity");
			parts.push(value);
		}
	} finally {
		signal.removeEventListener("abort", cancel);
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
	const result = new Uint8Array(size);
	let at = 0;
	for (const part of parts) {
		result.set(part, at);
		at += part.length;
	}
	return result;
}
function metadataBound(value, omitRuns = false) {
	let bytes = 2048;
	for (const [key, item] of Object.entries(value)) {
		if (omitRuns && key === "valueRuns") continue;
		bytes += key.length * 6;
		if (typeof item === "string") bytes += item.length * 6;
		else if (item !== null && typeof item === "object") throw Error("Compact wall cache metadata capacity");
		if (bytes > MAX_PART) throw Error("Compact wall cache fragment capacity");
	}
	return bytes;
}
/** Optional background work: one bounded fragment/stream at a time. Exact
* presentation only; no cursor/accumulator or display-resolution reduction. */
async function compactWallPresentation(identity, segments, signal) {
	if (typeof CompressionStream !== "function" || !identity || identity.length > 8192 || segments.length > 1e5) throw Error("Compact wall cache unavailable or capacity");
	await yieldHistoryTask(signal, "background");
	signal.throwIfAborted();
	const result = {
		version: 1,
		identity,
		segments: segments.length,
		runs: 0,
		bytes: 0,
		retainedBytes: 0,
		decodedBytes: 0,
		chunks: []
	};
	let rows = [], size = 2, yielded = performance.now();
	const flush = async () => {
		if (!rows.length) return;
		signal.throwIfAborted();
		const raw = new TextEncoder().encode("[" + rows.join(",") + "]");
		if (raw.length > MAX_PART || result.decodedBytes + raw.length > MAX_DECODED || result.chunks.length >= 1024) throw Error("Compact wall cache decoded capacity");
		const body = await transform(raw, true, MAX_ENCODED - result.bytes, signal);
		if (result.bytes + body.length > MAX_ENCODED) throw Error("Compact wall cache encoded capacity");
		result.chunks.push({
			body,
			hash: await hash(raw),
			decodedBytes: raw.length,
			rows: rows.length
		});
		result.bytes += body.length;
		result.decodedBytes += raw.length;
		rows = [];
		size = 2;
		await yieldHistoryTask(signal, "background");
		signal.throwIfAborted();
		yielded = performance.now();
	};
	for (const [index, segment] of segments.entries()) {
		const total = segment.valueRuns.length, headerBytes = metadataBound(segment, true) + 128;
		result.runs += total;
		if (result.runs > 1e6) throw Error("Compact wall cache value capacity");
		let offset = 0;
		do {
			signal.throwIfAborted();
			let count = 0, bound = headerBytes;
			while (offset + count < total && count < 256) {
				const pointBytes = metadataBound(segment.valueRuns[offset + count]);
				if (headerBytes + pointBytes > MAX_PART) throw Error("Compact wall cache fragment capacity");
				if (count && bound + pointBytes > TARGET) break;
				bound += pointBytes;
				count++;
			}
			const row = {
				index,
				offset,
				total,
				segment: {
					...segment,
					valueRuns: segment.valueRuns.slice(offset, offset + count)
				}
			}, text = timedSync("stringifyMs", () => JSON.stringify(row)), bytes = new TextEncoder().encode(text).length;
			if (bytes + 2 > MAX_PART) throw Error("Compact wall cache fragment capacity");
			if (size + bytes + 1 > TARGET) await flush();
			rows.push(text);
			size += bytes + 1;
			offset += count;
			if (performance.now() - yielded >= 8) {
				await yieldHistoryTask(signal, "background");
				signal.throwIfAborted();
				yielded = performance.now();
			}
		} while (offset < total);
	}
	await flush();
	result.retainedBytes = result.bytes + result.chunks.length * 256 + identity.length * 2 + 256;
	if (result.retainedBytes > MAX_ENCODED) throw Error("Compact wall cache metadata capacity");
	return result;
}
/** Decode at most one bounded chunk before yielding. Partial delivery remains
* a cached revision, never proof that fresh requested coverage is complete. */
async function replayCompactWallPresentation(value, identity, signal, publish) {
	if (value.version !== 1 || value.identity !== identity || !integer(value.segments) || value.segments > 1e5 || !integer(value.runs) || value.runs > 1e6 || !integer(value.bytes) || value.bytes > MAX_ENCODED || !integer(value.retainedBytes) || value.retainedBytes > MAX_ENCODED || !integer(value.decodedBytes) || value.decodedBytes > MAX_DECODED || !Array.isArray(value.chunks) || value.chunks.length > 1024) throw Error("Invalid compact wall cache identity");
	if (value.retainedBytes !== value.bytes + value.chunks.length * 256 + identity.length * 2 + 256) throw Error("Invalid compact wall cache retained total");
	let index = 0, runs = 0, decoded = 0, encoded = 0, pending, header;
	const ids = /* @__PURE__ */ new Set();
	for (const chunk of value.chunks) {
		signal.throwIfAborted();
		if (!(chunk.body instanceof Uint8Array) || !integer(chunk.decodedBytes) || chunk.decodedBytes < 2 || chunk.decodedBytes > MAX_PART || !integer(chunk.rows) || chunk.rows < 1) throw Error("Invalid compact wall cache chunk");
		encoded += chunk.body.length;
		decoded += chunk.decodedBytes;
		if (encoded > value.bytes || decoded > value.decodedBytes) throw Error("Invalid compact wall cache byte total");
		const raw = await transform(chunk.body, false, chunk.decodedBytes, signal);
		if (raw.length !== chunk.decodedBytes || await hash(raw) !== chunk.hash) throw Error("Compact wall cache content hash mismatch");
		const rows = timedSync("parseMs", () => JSON.parse(new TextDecoder().decode(raw))), ready = [];
		if (!Array.isArray(rows) || rows.length !== chunk.rows) throw Error("Invalid compact wall cache rows");
		for (const row of rows) {
			if (!row || row.index !== index || !integer(row.offset) || !integer(row.total) || row.total > 1e5 || !row.segment || typeof row.segment.id !== "string" || !Array.isArray(row.segment.valueRuns) || row.segment.valueRuns.length > 256) throw Error("Invalid compact wall cache fragment");
			const { valueRuns, ...meta } = row.segment, nextHeader = JSON.stringify(meta);
			if (!pending) {
				if (row.offset !== 0 || ids.has(row.segment.id)) throw Error("Invalid compact wall cache segment order");
				pending = {
					...row,
					segment: {
						...row.segment,
						valueRuns: []
					}
				};
				header = nextHeader;
			}
			if (row.total !== pending.total || row.offset !== pending.segment.valueRuns.length || nextHeader !== header || row.offset + valueRuns.length > row.total || row.total > row.offset && !valueRuns.length) throw Error("Invalid compact wall cache fragment coverage");
			pending.segment.valueRuns.push(...valueRuns);
			if (pending.segment.valueRuns.length === pending.total) {
				ready.push(pending.segment);
				ids.add(pending.segment.id);
				runs += pending.total;
				if (runs > value.runs) throw Error("Invalid compact wall cache value total");
				pending = void 0;
				header = void 0;
				index++;
			}
		}
		signal.throwIfAborted();
		if (ready.length) timedSync("publishMs", () => publish(ready));
		await yieldHistoryTask(signal, "user-visible");
	}
	signal.throwIfAborted();
	if (pending || index !== value.segments || runs !== value.runs || decoded !== value.decodedBytes || encoded !== value.bytes) throw Error("Incomplete compact wall cache coverage");
}
let metrics = {};
let sliceAt = performance.now();
function resetMetrics() {
	metrics = {};
	sliceAt = performance.now();
}
function getMetrics() {
	return metrics;
}
function endSlice() {
	metrics.longestActiveSliceMs = Math.max(metrics.longestActiveSliceMs ?? 0, performance.now() - sliceAt);
}
function timedSync(k, op) {
	const at = performance.now();
	try {
		return op();
	} finally {
		metrics[k] = (metrics[k] ?? 0) + performance.now() - at;
	}
}
async function measured(k, op) {
	endSlice();
	const at = performance.now();
	try {
		return await op();
	} finally {
		metrics[k] = (metrics[k] ?? 0) + performance.now() - at;
		metrics[k + "Calls"] = (metrics[k + "Calls"] ?? 0) + 1;
		sliceAt = performance.now();
	}
}
const hash = (b) => measured("hashMs", () => hashImpl(b));
const transform = (...args) => measured(args[1] ? "compressionMs" : "decompressionMs", () => transformImpl(...args));
const yieldHistoryTask = (...args) => measured("yieldMs", () => yieldHistoryTask$1(...args));
//#endregion
export { compactWallPresentation, getMetrics, replayCompactWallPresentation, resetMetrics };
