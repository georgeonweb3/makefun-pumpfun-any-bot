// TailChaser: a deterministic paper-trading bot for the pump.fun replay
// (agent-fun/replay/v2). It buys fresh breakouts with small size, banks
// half at +20%, half of the rest at +100%, and lets the final quarter
// ride with a trailing stop only — the rare runner pays for the many
// small losers, which are cut fast at -8%. The strategy lives in
// strategy.ts; this file only wires it to the harness.
//
// The grader runs `node /bot/main.ts` with this directory mounted at /bot.
// No network, no clock, no randomness: every decision is a pure function
// of the hello message and the batches seen so far, so two runs produce
// byte-identical action logs.

// Final params (swept over 60+ variants on the dev window): 40-slot
// entry window, 250-1500 slot age band, 0.015 SOL micro size, one entry
// per coin, 0.5% buy slippage, +25% first take-profit, fast 10-slot
// fade exit. Dev window: -0.032 SOL, 92 coins, 0.38% max drawdown.
import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
