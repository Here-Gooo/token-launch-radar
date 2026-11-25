// The token radar's model: one sealed snapshot in, one ranked board out.
//
// Every number the board carries is derived from the snapshot's own figures — TVL, seven-day growth,
// age with no token, and one calibration step that reads the snapshot's live-token protocols (which
// carry both a TVL and a market cap) to price each category's mcap/TVL multiple. No protocol name is
// ever special-cased; the same function scores every row, and the sort is fully deterministic.
//
//   implied_value_usd = round( tvl_usd x categoryMultiple x momentum x readiness ), min 1
//
//   categoryMultiple  median mcap/TVL of the snapshot's own live-token protocols in the same category
//                     (sample < 5 -> the global median over all live protocols; clamped to 0.05..20)
//   momentum          1 + clamp(change_7d, -60, +120)/100 x 0.5        (unknown growth -> 1.0)
//   readiness         0.4 at day 0 rising to 0.7 by day 90; 1.0 from day 90 through day 730;
//                     easing linearly to 0.6 by day 1095; 0.6 after. Unknown age -> the pre-token
//                     median age, itself derived from the snapshot.
//
// The model's reading: TVL sizes the flywheel a token would monetize; the category multiple is what
// the market has actually paid for that flywheel in this snapshot; momentum scales the launch
// multiple by seven-day flows; readiness weights how much retroactive value a farm position can
// still accrue — young protocols have thin usage to reward, prime-age ones the most, and protocols
// that have run for years with no token may simply never launch one.

import { farmSteps } from './plans.ts';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  momentum_floor: number;
  momentum_cap: number;
  momentum_weight: number;
  readiness_day0: number;
  readiness_ramp_end: number;
  readiness_at_ramp_end: number;
  prime_end_day: number;
  stale_end_day: number;
  readiness_stale: number;
  multiple_min: number;
  multiple_max: number;
  min_calibration_sample: number;
}

export const MODEL: ModelConstants = {
  momentum_floor: -60,
  momentum_cap: 120,
  momentum_weight: 0.5,
  readiness_day0: 0.4,
  readiness_ramp_end: 90,
  readiness_at_ramp_end: 0.7,
  prime_end_day: 730,
  stale_end_day: 1095,
  readiness_stale: 0.6,
  multiple_min: 0.05,
  multiple_max: 20,
  min_calibration_sample: 5,
};

/** The model's version label: the dashboard names it and the board carries it. */
export const MODEL_VERSION = 'radar-2-calibrated';

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The middle value of a sorted copy of `values`; the mean of the two middles on an even count. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Whether a protocol records no token at all (no market cap, no CoinGecko id, no symbol). */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * The categories the watchlist rule leaves out: a wrapped, staked or bridged product of a token that
 * already trades, or an exchange's own book. The same exclusions shape the early radar, so the board
 * ranks only protocols whose token would be a launch of its own.
 */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name carrying a whole word wrapped, staked or staking in any case is a product of a live token. */
const PRODUCT_WORDS = /\b(wrapped|staked|staking)\b/i;

/** An exchange's name at the front of a protocol name marks the exchange's own product. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol is one the board may rank: pre-token and none of the watchlist rule's exclusions. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (PRODUCT_WORDS.test(p.name)) return false;
  for (const prefix of EXCHANGE_PREFIXES) if (p.name.startsWith(prefix)) return false;
  return true;
}

/** One calibration row: what the snapshot's own live protocols say a category's token is worth. */
export interface CalibrationRow {
  category: string;
  /** Live protocols in this category with both a TVL and a market cap. */
  sample_count: number;
  /** Their median mcap/TVL ratio, unclamped. */
  median_ratio: number | null;
  /** The multiple the model uses: the median clamped, or the global median when the sample is thin. */
  multiple: number;
  /** Where the multiple came from: this category's own sample, or the global fallback. */
  source: 'category' | 'global';
}

/** The calibration the snapshot's live-token protocols provide, one row per category the board uses. */
export interface Calibration {
  rows: CalibrationRow[];
  global_median: number | null;
  global_count: number;
  /** Median age in days of the pre-token protocols whose listing date is known. */
  median_pre_token_age: number | null;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * Read the calibration out of the snapshot: for every category the board will rank, the median
 * mcap/TVL of its live-token peers (categories with fewer than MIN_CALIBRATION_SAMPLE live peers
 * fall back to the snapshot-wide median), plus the median age of dated pre-token protocols.
 */
export function buildCalibration(snapshot: Snapshot): Calibration {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    allRatios.push(ratio);
    const key = p.category ?? '(uncategorized)';
    let list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, (list = []));
    list.push(ratio);
  }
  const globalMedian = median(allRatios);
  const globalCount = allRatios.length;

  // The categories the board actually ranks, so the calibration table shows only rows in use.
  const usedCategories = new Set<string>();
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p] as const));
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) usedCategories.add(p.category ?? '(uncategorized)');
  }
  for (const p of snapshot.protocols) {
    if (!isRankable(p)) continue;
    if (snapshot.watchlist.includes(p.slug)) continue;
    usedCategories.add(p.category ?? '(uncategorized)');
  }

  const rows: CalibrationRow[] = [...usedCategories].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((category) => {
    const sample = ratiosByCategory.get(category) ?? [];
    const sampleMedian = median(sample);
    if (sample.length >= MODEL.min_calibration_sample && sampleMedian !== null) {
      return { category, sample_count: sample.length, median_ratio: round4(sampleMedian), multiple: round4(clamp(sampleMedian, MODEL.multiple_min, MODEL.multiple_max)), source: 'category' as const };
    }
    const fallback = globalMedian === null ? 1 : clamp(globalMedian, MODEL.multiple_min, MODEL.multiple_max);
    return { category, sample_count: sample.length, median_ratio: sampleMedian === null ? null : round4(sampleMedian), multiple: round4(fallback), source: 'global' as const };
  });

  const ages: number[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age !== null) ages.push(age);
  }
  const medianAge = median(ages);
  return {
    rows,
    global_median: globalMedian === null ? null : round4(globalMedian),
    global_count: globalCount,
    median_pre_token_age: medianAge === null ? null : Math.round(medianAge),
  };
}

/** The momentum multiplier from the seven-day TVL change, per the stated model. */
export function momentumOf(change7d: number | null): { value: number; clampedPct: number } {
  const raw = change7d === null ? 0 : finite(change7d, 0);
  const clampedPct = clamp(raw, MODEL.momentum_floor, MODEL.momentum_cap);
  return { value: 1 + (clampedPct / 100) * MODEL.momentum_weight, clampedPct };
}

/** The readiness multiplier from the age with no token: the model's stated piecewise curve. */
export function readinessOf(age: number): number {
  if (age < MODEL.readiness_ramp_end) {
    const t = Math.max(0, age) / MODEL.readiness_ramp_end;
    return MODEL.readiness_day0 + (MODEL.readiness_at_ramp_end - MODEL.readiness_day0) * t;
  }
  if (age <= MODEL.prime_end_day) return 1;
  if (age <= MODEL.stale_end_day) {
    const t = (age - MODEL.prime_end_day) / (MODEL.stale_end_day - MODEL.prime_end_day);
    return 1 - (1 - MODEL.readiness_stale) * t;
  }
  return MODEL.readiness_stale;
}

/** What one protocol is worth, with every factor the dashboard shows. */
export interface Scored {
  implied: number;
  age: number | null;
  momentum: number;
  clampedGrowth: number;
  readiness: number;
  multiple: number;
  multipleSource: 'category' | 'global';
  multipleSample: number;
  multipleRatio: number | null;
}

export function scoreProtocol(p: SnapshotProtocol, calibration: Calibration, age: number | null): Scored {
  const catKey = p.category ?? '(uncategorized)';
  const row = calibration.rows.find((r) => r.category === catKey);
  const growth = momentumOf(p.change_7d);
  const ageForModel = age ?? calibration.median_pre_token_age ?? 365;
  const readiness = readinessOf(ageForModel);
  const implied = Math.max(1, Math.round(p.tvl_usd * row!.multiple * growth.value * readiness));
  return {
    implied,
    age,
    momentum: round4(growth.value),
    clampedGrowth: growth.clampedPct,
    readiness: round4(readiness),
    multiple: row!.multiple,
    multipleSource: row!.source,
    multipleSample: row!.sample_count,
    multipleRatio: row!.median_ratio,
  };
}

/** One row of board.json and of the dashboard's data. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  multiple: number;
  multiple_source: 'category' | 'global';
  multiple_sample: number;
  momentum: number;
  readiness: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the market cap is a fact, never a model's claim. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  mcap_tvl_ratio: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: CalibrationRow[];
  global_median: number | null;
  global_count: number;
  median_pre_token_age: number | null;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** The protocols the board ranks: the whole watchlist plus every early, rankable pre-token protocol. */
export function buildBoard(snapshot: Snapshot, calibration: Calibration): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p] as const));
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug)) continue;
    if (p.tvl_usd >= snapshot.floor_usd) continue;
    if (!isRankable(p)) continue;
    chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    return { p, age, s: scoreProtocol(p, calibration, age) };
  });
  // Implied value descending; ties break by slug ascending, so two runs write the same bytes.
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((entry, i) => {
    const { p, age, s } = entry;
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: age,
      watchlist: watchlist.has(p.slug),
      implied_value_usd: s.implied,
      multiple: s.multiple,
      multiple_source: s.multipleSource,
      multiple_sample: s.multipleSample,
      momentum: s.momentum,
      readiness: s.readiness,
      farm_steps: farmSteps(p, age),
    };
  });
}

/** The live-token view: every protocol that already trades, by market cap. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      mcap_tvl_ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
      change_7d: p.change_7d,
    }))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
}

/** Assemble the whole dataset the dashboard renders. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const calibration = buildCalibration(snapshot);
  const board = buildBoard(snapshot, calibration);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    calibration: calibration.rows,
    global_median: calibration.global_median,
    global_count: calibration.global_count,
    median_pre_token_age: calibration.median_pre_token_age,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}
