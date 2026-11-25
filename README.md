# Token Launch Radar

[![Token Launch Radar — token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/Here-Gooo/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/Here-Gooo/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A radar for protocols that **record no token yet**, ranked by what a token launch would
imply, each with a farm plan that names its cost and its time. Built for
[make.fun competition token-radar-01](https://make.fun/c/token-radar-01): one sealed
snapshot of 758 DeFi protocols in, one ranked board, one dashboard and one dossier out.

## What it does

- **Ranks 178 pre-token protocols** by implied value: the whole 40-protocol watchlist
  (every protocol at or above the snapshot's $50M TVL floor that records no token) plus
  138 early protocols below the floor, so a launch can be spotted before it is news.
- **Separates live from pre-token.** The 416 protocols that already trade are set aside:
  a market cap is a fact, so there is nothing to imply. They are the calibration instead —
  their mcap÷TVL ratios price every category on the board.
- **Derives everything from the snapshot itself.** No hardcoded prices, no special-cased
  names, no network calls at run time; the same function scores every row, and two runs
  write byte-identical output.
- **Ships a farm plan per row**: eight concrete steps with a cost band and a time band,
  read off the protocol's own chains and size.

## The value model

```
implied_value_usd = round( tvl_usd × multiple × momentum × readiness )
```

| Factor | What it says | Where it comes from |
| --- | --- | --- |
| `multiple` | What live tokens pay for a dollar of TVL | Median mcap÷TVL of the snapshot's own live-token protocols in the same category; categories with fewer than 5 live peers use the snapshot-wide median (0.2138x from 128 live protocols); clamped to 0.05–20x at use |
| `momentum` | Flow direction | `1 + clamp(change_7d, −60%, +120%) ÷ 100 × 0.5`; unreported flows sit at a neutral 1.0x |
| `readiness` | How much retroactive value a farm position can still accrue | 0.4x at day 0 rising to 0.7x by day 90; 1.0x from day 90 through day 730; easing linearly to 0.6x by day 1095; 0.6x after. Unknown age uses the snapshot's pre-token median age (513 days) |

Ties break by slug ascending, so the board is fully deterministic. The dashboard renders
this same arithmetic next to every row and recomputes it in the browser — the detail view
shows the model breakdown and confirms it matches `board.json`.

"Records no token" means the snapshot's index carries no token today; it is not proof
that none exists. Implied value is a model's claim — never a price, never a promise,
never advice.

## Run it

Node 22+ (runs the TypeScript directly, standard library only, no install step):

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

`/input/snapshot.json` is the sealed snapshot (or pass any file or directory holding one).
`MAKEFUN_OUTPUT_DIR` stands in for the grader's `/output` outside its container. The run
writes `out/board.json`, `out/data.js`, copies `dashboard/` and `screenshots/` beside
them, and writes `out/dossier.json`. Open `out/dashboard/index.html` in a browser — it
reads `../data.js` from the same run, entirely offline.

## Layout

```
main.ts                  pipeline: parse, score, gate-check, write, dossier
lib/model.ts             the value model, calibration and board assembly
lib/plans.ts             the farm-step generator (cost and time bands per chain and size)
dashboard/               the page: index.html + app.css + app.js (data.js is written beside it, not inside)
screenshots/             three verified 1440×900 captures of the running page
vendor/makefun-board.ts  vendored make.fun library (byte-identical to the kit's)
.makefun/owner.json      the wallet that claims this entry
```

## Data

Snapshot: DefiLlama, fetched 2026-11-14. The dashboard's footer links the same source.
