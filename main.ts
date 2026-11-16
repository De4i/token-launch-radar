// Token launch radar — the program behind the dashboard.
//
// Reads the sealed snapshot and prices every protocol that records no token from the snapshot's own
// figures: a log-log fit of market cap per $1 of TVL on TVL and on how long the protocol has run,
// calibrated per category from the protocols whose token already trades, with the seven-day TVL
// change applied as a damped momentum term. Then it ranks them, writes a farm plan for each, and
// writes the board, the page's data and the dossier.
//
// Node 22, standard library only, no network. Nothing here is a forecast: every value is a
// comparable drawn from the snapshot, and the board says so.

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
};

const inputDir = arg('input', process.env.MAKEFUN_INPUT_DIR ?? '/input');
const inputFile = inputDir.endsWith('.json') ? inputDir : join(inputDir, 'snapshot.json');
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}\n`);
  process.exit(2);
}

type Proto = {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
};
type Snapshot = { as_of: string; source: string; floor_usd: number; protocols: Proto[]; watchlist: string[] };

const bytes = readFileSync(inputFile);
const snap: Snapshot = JSON.parse(bytes.toString('utf8'));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const AS_OF = Date.parse(snap.as_of);
const DAYS = 86_400_000;

const median = (xs: number[]): number => {
  if (xs.length === 0) return 1;
  const s = [...xs].sort((a, b) => a - b);
  return (s[Math.floor((s.length - 1) / 2)]! + s[Math.ceil((s.length - 1) / 2)]!) / 2;
};
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const multipleOf = (p: Proto): number => p.mcap_usd! / p.tvl_usd;

/** The three figures the snapshot gives that price a launch: TVL, time with no token, 7-day change. */
const ageTerm = (p: Proto): number =>
  p.listed_at === null ? 0 : Math.log1p(Math.max(0, (AS_OF - Date.parse(p.listed_at)) / DAYS));
const designRow = (p: Proto): [number, number, number] => [1, Math.log(p.tvl_usd), ageTerm(p)];

/** Least squares by normal equations, 3 unknowns: exact, and 128 refits cost nothing. */
function solveNormal(rows: Proto[]): [number, number, number] {
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const y = [0, 0, 0];
  for (const p of rows) {
    const x = designRow(p);
    const v = Math.log(multipleOf(p));
    for (let i = 0; i < 3; i++) {
      y[i]! += x[i]! * v;
      for (let j = 0; j < 3; j++) A[i]![j]! += x[i]! * x[j]!;
    }
  }
  for (let i = 0; i < 3; i++) {
    const piv = A[i]![i]!;
    for (let j = i; j < 3; j++) A[i]![j]! /= piv;
    y[i]! /= piv;
    for (let j = 0; j < 3; j++) {
      if (j === i) continue;
      const f = A[j]![i]!;
      if (f === 0) continue;
      for (let c = i; c < 3; c++) A[j]![c]! -= f * A[i]![c]!;
      y[j]! -= f * y[i]!;
    }
  }
  return [y[0]!, y[1]!, y[2]!];
}

const live = snap.protocols.filter((p) => (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0 && (p.gecko_id !== null || p.symbol !== null));
const globalMultiple = median(live.map(multipleOf));
const BETA = solveNormal(live);

/** Category calibration: a half-strength pull of the category's own median multiple onto the fit. */
const CAT_WEIGHT = 0.5;
const MIN_MEMBERS = 1;
function categoryFactor(p: Proto, pool: Proto[]): { factor: number; medianMultiple: number; members: number } {
  const group = pool.filter((q) => q.category === p.category);
  if (group.length < MIN_MEMBERS) return { factor: 1, medianMultiple: globalMultiple, members: 0 };
  const local = median(group.map(multipleOf));
  return { factor: (local / globalMultiple) ** CAT_WEIGHT, medianMultiple: local, members: group.length };
}

const GROWTH_DIVISOR = 500;
const GROWTH_CAP = 0.2;
const VALUE_CAP = 1e14;

/** The board's rule, in one place, so the page, the board and the check all mean the same thing. */
function price(p: Proto, pool: Proto[], beta: [number, number, number]) {
  const base = Math.exp(beta[0] + beta[1] * Math.log(p.tvl_usd) + beta[2] * ageTerm(p));
  const cat = categoryFactor(p, pool);
  const growth = clamp(1 + (p.change_7d ?? 0) / GROWTH_DIVISOR, 1 - GROWTH_CAP, 1 + GROWTH_CAP);
  const multiple = base * cat.factor * growth;
  return {
    value: Math.round(clamp(p.tvl_usd * multiple, 1, VALUE_CAP)),
    base, baseline: base, category: cat.factor, categoryMultiple: cat.medianMultiple, members: cat.members,
    growth, multiple, ageDays: p.listed_at === null ? null : Math.max(0, (AS_OF - Date.parse(p.listed_at)) / DAYS),
  };
}

// Leave-one-out on the comparable: price each live protocol from the others by exactly the rule
// above, then compare with the market cap it really has. Same rows are used to fit and to score,
// which flatters the percentage; the page says so.
const holdout = live.map((p) => {
  const pool = live.filter((q) => q.slug !== p.slug);
  const ratio = p.mcap_usd! / price(p, pool, solveNormal(pool)).value;
  return ratio;
});
const sortedRatios = [...holdout].sort((a, b) => a - b);
const quantile = (q: number): number => sortedRatios[Math.min(sortedRatios.length - 1, Math.floor((sortedRatios.length - 1) * q))]!;
const within3x = holdout.filter((r) => r >= 1 / 3 && r <= 3).length / holdout.length;

// ---- which protocols are on the radar ------------------------------------------------------------

const excludedCategory = /^(Bridge|Canonical Bridge|Liquid Staking|Liquid Restaking|Restaked BTC|CEX)$/i;
const exchange = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const wrapped = /\b(wrapped|staked|staking)\b/i;
const versionMarker = /\s[vV]?\d+(\.\d+)?$/;
const watch = new Set(snap.watchlist);
const preToken = (p: Proto): boolean =>
  p.gecko_id === null && p.symbol === null && !excludedCategory.test(p.category ?? '') &&
  !wrapped.test(p.name) && !versionMarker.test(p.name) && !exchange.test(p.name);

const FLOOR_EXTRA = 160; // the watchlist is the floor, never the ceiling
const carried = snap.protocols.filter((p) => !watch.has(p.slug) && preToken(p))
  .sort((a, b) => b.tvl_usd - a.tvl_usd).slice(0, FLOOR_EXTRA);
const rowSources = snap.protocols.filter((p) => watch.has(p.slug) || carried.includes(p));

const TEST_CAPITAL = 1000;
const TEST_TICKET = 50;
const SHARE = 0.03;
const HOLD_DAYS = 30;

function planFor(p: Proto) {
  const chains = p.chains ?? [];
  const chain = chains.find((c) => /Arbitrum|Base|Optimism|Polygon|Solana/.test(c)) ?? chains[0] ?? 'its listed network';
  const gas = chain === 'Ethereum' ? 28 : chain === 'Solana' ? 2 : 6;
  const cat = p.category ?? 'Unclassified';
  let act = 'verify the protocol docs, then use a permissionless deposit or usage flow';
  let short = 'verify, then deposit';
  if (/Lending|CDP|Credit/.test(cat)) { act = 'supply a supported asset without borrowing, inside the documented limits'; short = 'supply only, no borrow'; }
  else if (/Dex|AMM|Liquidity|Market Maker/.test(cat)) { act = 'make a small spot swap, then a balanced LP position if the range suits'; short = 'small swap, then LP'; }
  else if (/Derivatives|Perpetual|Options|Synthetic/.test(cat)) { act = 'test the interface in simulation only; no live leverage for rewards'; short = 'simulate, no leverage'; }
  else if (/Yield|Vault|Farm|Restak/.test(cat)) { act = 'read the vault strategy, fees and exit queue before depositing a supported asset'; short = 'read vault, then deposit'; }
  else if (/RWA|Insur|Payment/.test(cat)) { act = 'check jurisdiction, KYC and redemption terms before considering a deposit'; short = 'check KYC first'; }
  else if (/Chain|Rollup|Infra|Oracle|Bridge/.test(cat)) { act = 'run a documented node or testnet task, and register where the docs allow'; short = 'node or testnet task'; }
  const steps = [
    `Verify · 20–40 min · $0. Confirm ${p.name}'s official domain, token status, contracts, audits and any participation rules independently. This snapshot records no token for ${p.name}; that is not a reward program.`,
    `Trial · 15–30 min · about $${TEST_TICKET} of test capital on ${chain}. ${act[0]!.toUpperCase()}${act.slice(1)}. Walk away from any flow whose rules or risks you cannot verify.`,
    `Position · optional, $${TEST_CAPITAL.toLocaleString('en-US')} principal, not a fee. Budget about $${gas} of network cost on ${chain} for entry and exit; check slippage, protocol fees and lock-ups before signing.`,
    `Observe · about 10 min a week for ${HOLD_DAYS} days. Keep receipts and read announcements; do not wash-trade to inflate usage. Stop if the protocol changes its risk terms.`,
    `Exit · allow 15–30 min plus any documented queue. Withdraw the trial first, revoke unused approvals, and record the fees you actually paid. Principal can be lost to contracts, markets or depegging.`,
  ];
  return {
    chain, gas, act, steps, short,
    capitalLine: `$${TEST_TICKET} trial + $${(TEST_CAPITAL / 1000)}k optional`,
    holdLine: `${HOLD_DAYS}-day hold`,
    capital: `$${TEST_TICKET} trial + optional $${TEST_CAPITAL.toLocaleString('en-US')} position`,
    hold: `${HOLD_DAYS}-day observation`,
  };
}

const rows = rowSources.map((p) => {
  const m = price(p, live, BETA);
  const plan = planFor(p);
  const upside = m.value * SHARE * TEST_CAPITAL / p.tvl_usd;
  return {
    slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
    change_7d: p.change_7d, mcap_usd: p.mcap_usd, listed_at: p.listed_at,
    rank: 0, implied_value_usd: m.value,
    low: Math.round(m.value * quantile(0.25)), high: Math.round(m.value * quantile(0.75)),
    model: m, watch: watch.has(p.slug), farm_steps: plan.steps, plan,
    scenario_gross: upside,
    opportunity_cost: TEST_CAPITAL * 0.04 * HOLD_DAYS / 365,
    scenario_net: Math.round((upside - plan.gas - TEST_CAPITAL * 0.04 * HOLD_DAYS / 365) * 100) / 100,
    verdict: upside - plan.gas - TEST_CAPITAL * 0.04 * HOLD_DAYS / 365 > 10 ? 'farm' : upside - plan.gas - TEST_CAPITAL * 0.04 * HOLD_DAYS / 365 > 0 ? 'thin' : 'skip',
    break_even: m.value * SHARE / p.tvl_usd > 0.04 * HOLD_DAYS / 365 ? Math.ceil(plan.gas / (m.value * SHARE / p.tvl_usd - 0.04 * HOLD_DAYS / 365)) : null,
  };
}).sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
rows.forEach((r, i) => { r.rank = i + 1; });

const categoryTable = (() => {
  const by = new Map<string, Proto[]>();
  for (const p of live) {
    const k = p.category ?? 'Unclassified';
    by.set(k, [...(by.get(k) ?? []), p]);
  }
  return [...by.entries()].map(([category, group]) => ({
    category, members: group.length,
    medianMultiple: median(group.map(multipleOf)),
    medianTvl: median(group.map((p) => p.tvl_usd)),
    largest: group.slice().sort((a, b) => b.tvl_usd - a.tvl_usd)[0]!.slug,
    boardRows: rows.filter((r) => (r.category ?? 'Unclassified') === category).length,
  })).sort((a, b) => b.members - a.members);
})();

const data = {
  as_of: snap.as_of, source: snap.source, sha256, floor_usd: snap.floor_usd, rows,
  live: live.map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, multiple: multipleOf(p) })),
  categories: categoryTable,
  stats: {
    rows: rows.length, watch: snap.watchlist.length, protocols: snap.protocols.length, live: live.length,
    total: rows.reduce((s, r) => s + r.implied_value_usd, 0),
    within3x, medianError: median(holdout), q25: quantile(0.25), q75: quantile(0.75), q95: quantile(0.95),
    beta: BETA, globalMultiple, catWeight: CAT_WEIGHT, growthDivisor: GROWTH_DIVISOR, growthCap: GROWTH_CAP,
    valueCap: VALUE_CAP, testCapital: TEST_CAPITAL, share: SHARE, holdDays: HOLD_DAYS,
    stacked: rows.filter((r) => (r.change_7d ?? 0) > 0).length,
    worthFarming: rows.filter((r) => r.scenario_net > 0).length,
    zeroChange: rows.filter((r) => r.change_7d === null).length,
  },
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), JSON.stringify({ rows }, null, 2));
writeFileSync(join(out, 'data.js'), `window.RADAR=${JSON.stringify(data)};`);
for (const dir of ['dashboard', 'screenshots']) {
  const from = join(here, dir);
  if (existsSync(from)) cpSync(from, join(out, dir), { recursive: true });
}
if (existsSync(join(out, 'screenshots'))) {
  writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 65_536 }));
}
process.stdout.write(
  `token radar: ${rows.length} rows, ${snap.watchlist.length} on the watchlist, ${live.length} live comparables, ` +
  `fit ln(mcap/TVL) = ${BETA[0]!.toFixed(4)} + ${BETA[1]!.toFixed(4)}·ln(TVL) + ${BETA[2]!.toFixed(4)}·ln(1+age), ` +
  `leave-one-out ${(within3x * 100).toFixed(1)}% within 3x, median error ${median(holdout).toFixed(2)}x\n`,
);
