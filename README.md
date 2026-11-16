# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/De4i/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/De4i/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token radar: it reads a sealed DefiLlama snapshot, finds every protocol that still records no token, prices what its launch would be worth as a comparable fitted from the protocols whose token already trades, ranks the board, and gives each row a farm plan with its own costs and durations. The dashboard renders offline — a ranked board, a detail view per protocol, a comparables view and the method.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

Then open `out/dashboard/index.html` with `out/data.js` beside it (the program copies the dashboard, the screenshots and writes `dossier.json`).

## Where things are

| Path | What it is |
|---|---|
| `main.ts` | the program: reads the snapshot, fits the model, writes `out/board.json`, `out/data.js`, `out/dossier.json` |
| `vendor/makefun-board.ts` | the kit's dossier library, unmodified |
| `dashboard/` | the static page: `index.html`, `app.css`, `app.js` (no network, no framework) |
| `screenshots/` | the three gate screenshots: cover board, protocol detail, filtered view |
| `tools/shoot.py` | local capture harness (not part of the page) |

## The model, in one line

`implied_value = TVL × exp(fit at this TVL and age) × category_pull × growth`, where the fit is a least-squares line of `ln(market cap / TVL)` on `ln(TVL)` and `ln(1 + days tracked)` over the snapshot's live protocols, the category pull is that category's median multiple onto the fit at half strength, and growth is the seven-day TVL change clamped to ±20%. Leave-one-out over the live protocols, the board's own rule lands within a factor of three 44% of the time. A comparable, never a forecast, and not financial advice.

---

<sub>Entered on [make.fun](https://make.fun/?ref=wftbn3z4&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
