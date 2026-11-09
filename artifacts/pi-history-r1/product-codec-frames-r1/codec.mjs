// src/shared/order-wall-point-transport.ts
var WALL_POINT_TRANSPORT = "exact-points-v1";
var WALL_PRODUCT_POINT_TRANSPORT = "exact-points-v2";
function exactProduct(price, quantity) {
  if (!decimal(price) || !decimal(quantity) || price.length > 128 || quantity.length > 128) return;
  const scale = (price.split(".")[1]?.length ?? 0) + (quantity.split(".")[1]?.length ?? 0);
  let value = String(BigInt(price.replace(".", "")) * BigInt(quantity.replace(".", ""))).padStart(scale + 1, "0");
  if (scale) value = (value.slice(0, -scale) + "." + value.slice(-scale)).replace(/0+$/, "").replace(/\.$/, "");
  return decimal(value) ? value : void 0;
}
var pointKeys = "at,usd,percentile,rank,quantity,quantityExact,notionalExact";
var record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var decimal = (v) => typeof v === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v) && Number.isFinite(Number(v));
var validRank = (v) => Number.isSafeInteger(v) && Number(v) >= 1 && Number(v) <= 10;
var pointOverhead = JSON.stringify({ at: 0, usd: 0, percentile: null, rank: 1, quantity: 0, quantityExact: "0", notionalExact: "0" }).length - JSON.stringify([0, "0", "0", 1]).length - 2;
async function encodeWallPointTransport(value, checkpoint, version = 1) {
  if (!Array.isArray(value) || value.length > 1e5) throw Error("Invalid wall point transport records");
  let changed = false, work = 0;
  const rows = [];
  for (const row of value) {
    if (!record(row) || !record(row.segment) || !Array.isArray(row.segment.valueRuns)) throw Error("Invalid wall point transport segment");
    const base = row.segment.start, points = [];
    if (row.segment.valueRuns.length > 1e5) throw Error("Wall point transport value capacity");
    for (const p of row.segment.valueRuns) {
      if (record(p) && Object.keys(p).join(",") === pointKeys && p.percentile === null && validRank(p.rank) && decimal(p.quantityExact) && decimal(p.notionalExact) && p.quantity === Number(p.quantityExact) && p.usd === Number(p.notionalExact) && Number.isSafeInteger(base) && Number.isSafeInteger(p.at) && Number.isSafeInteger(p.at - base) && base + (p.at - base) === p.at) {
        points.push(version === 2 && exactProduct(row.segment.priceExact, p.quantityExact) === p.notionalExact ? [p.at - base, p.quantityExact, p.rank] : [p.at - base, p.quantityExact, p.notionalExact, p.rank]);
        changed = true;
      } else points.push(p);
      if (++work > 1e6) throw Error("Wall point transport value capacity");
      if (work % 256 === 0) await checkpoint?.();
    }
    rows.push({ ...row, segment: { ...row.segment, valueRuns: points } });
  }
  return { value: rows, changed };
}
async function decodeWallPointTransport(value, checkpoint, budget, version = 1) {
  if (!Array.isArray(value) || value.length > 1e5) throw Error("Invalid wall point transport records");
  let changed = false, work = 0;
  for (const row of value) {
    if (!record(row) || !record(row.segment) || !Array.isArray(row.segment.valueRuns)) throw Error("Invalid wall point transport segment");
    const base = row.segment.start, points = [];
    if (row.segment.valueRuns.length > 1e5) throw Error("Wall point transport value capacity");
    for (const p of row.segment.valueRuns) {
      if (Array.isArray(p)) {
        const product = version === 2 && p.length === 3, notionalExact = product ? exactProduct(row.segment.priceExact, p[1]) : p[2], rank = product ? p[2] : p[3];
        if (p.length !== 4 && !product || !Number.isSafeInteger(base) || !Number.isSafeInteger(p[0]) || !Number.isSafeInteger(base + p[0]) || base + p[0] < 0 || !decimal(p[1]) || !decimal(notionalExact) || !validRank(rank)) throw Error("Invalid wall point transport tuple");
        const [delta, quantityExact] = p;
        const at = base + delta, usd = Number(notionalExact), quantity = Number(quantityExact);
        if (budget) {
          budget.bytes += pointOverhead + String(at).length + String(usd).length + String(quantity).length - String(delta).length + (product ? notionalExact.length + 3 : 0);
          if (budget.bytes > budget.max) throw Error("Wall point transport canonical byte capacity");
        }
        points.push({ at, usd, percentile: null, rank, quantity, quantityExact, notionalExact });
        changed = true;
      } else points.push(p);
      if (++work > 1e6) throw Error("Wall point transport value capacity");
      if (work % 256 === 0) await checkpoint?.();
    }
    row.segment.valueRuns = points;
  }
  return { value, changed };
}
export {
  WALL_POINT_TRANSPORT,
  WALL_PRODUCT_POINT_TRANSPORT,
  decodeWallPointTransport,
  encodeWallPointTransport
};
