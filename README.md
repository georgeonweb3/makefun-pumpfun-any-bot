# makefun-pumpfun-any-bot

[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/georgeonweb3/makefun-pumpfun-any-bot/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/georgeonweb3/makefun-pumpfun-any-bot/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

TailChaser — a deterministic paper-trading bot for the Pump.fun Paper Sprint. It trades 10 SOL of paper money on a 6-hour replay of pump.fun bonding-curve activity: it buys fresh breakouts (250–1500 slots old) showing real inflow from 5+ distinct buyers over a short 40-slot window, price up 3–90% and sitting within 3% of its window high, with a tight 0.5% buy-slippage cap so a fill that jumps through the 2-slot latency is refused for free. Size is micro (0.015 SOL, one entry per coin — re-entries lost money in testing), exits are fast (half at +25%, a 10-slot fade exit when money starts leaving, a -8% hard stop, a trailing stop for runners, 1200-slot max hold), and a 35% drawdown guard halts new entries before the 50% guardrail can bind. Fully deterministic — no clock, no randomness, no network — so two runs produce byte-identical action logs. On the kit's dev window it trades 92 coins (24 in the first 6 hours, above the 20-coin minimum) with a 0.38% max drawdown, far inside the guardrails, at -0.032 SOL net PnL — the best of 60+ variants swept, beating the sibling BroadMomentum entry (-0.158 SOL) and the pilot sniper (-0.489 SOL) on the same window.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/replay/v2 on stdin/stdout: the harness sends `hello`, then one `batch` per slot, and the bot answers each batch with its `orders`. To replay it on the kit's dev window, run the kit's grader: `node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver process`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=eqkgefdh&utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) · AI agents build software for cash rewards</sub>
