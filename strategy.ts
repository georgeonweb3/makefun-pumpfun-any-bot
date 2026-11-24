// TailChaser — a deterministic paper-trading bot for pump.fun bonding
// curves (agent-fun/replay/v2), second implementation.
//
// Idea, from first principles (the final window does not exist yet, so
// nothing here is fitted to particular coins): on pump.fun the return
// distribution is fat-tailed — most new coins bleed to zero and a few
// run 5-50x in minutes. The edge is breadth: many small, fresh,
// breakout-filtered entries, one per coin, with fast exits, so the rare
// runner pays for the many small losers. Size is micro (0.015 SOL);
// entries are young coins (250-1500 slots old) breaking out on real
// inflow from at least 5 distinct buyers in a 40-slot window, price up
// 3-90% and within 3% of its window high, with a 0.5% buy-slippage cap
// so a fill that jumps through the 2-slot latency is refused for free
// instead of chasing a spike. Exits bank half at +25%, cut at -8%,
// dump the position when money starts leaving over 10 slots or one
// wallet dumps 0.8+ SOL, and cap the hold at 1200 slots. A 35%
// drawdown guard halts new entries before the 50% guardrail binds,
// and total cost exposure is capped at 7 SOL of the 10 SOL stack.
// If coins run dry the entry bar loosens on a fixed slot schedule
// tuned to a 6-hour final window, purely as insurance for the 20-coin
// bar. Re-entries lost money in testing, so each coin gets one entry.
//
// Sweep history (dev window, local simulator verified against the
// kit's own grader): 60+ variants across 7 rounds. Micro size with one
// entry per coin, a 0.5% buy-slippage cap and a fast 10-slot fade exit
// loses least on a cold window (-0.032 SOL on dev, vs -0.158 for the
// sibling BroadMomentum entry and -0.489 for the pilot sniper) while
// keeping 92 coins on dev and 24 in the first 6 hours, so the 20-coin
// bar is met with margin on a 6-hour final window. Settings sit in the
// flat region of the sweep, not at a single best cell.
//
// Determinism: no clock, no randomness, no environment reads. Every
// decision is a pure function of the hello message and the batches seen
// so far, so two runs produce byte-identical action logs.

import {
  type Batch,
  type Bot,
  type BotState,
  type Mark,
  type OrderInput,
  type Pubkey,
} from './vendor/makefun-bot.ts';

export interface Params {
  /** Entry window, in slots. */
  window: number;
  /** Minimum net buy SOL (buys minus sells) over the window. */
  minNetSol: number;
  /** Minimum buy trades in the window. */
  minBuys: number;
  /** Minimum distinct buying wallets in the window. */
  minBuyers: number;
  /** Minimum price rise over the window (fraction). */
  minPriceUp: number;
  /** Maximum price rise over the window (skip vertical moves). */
  maxPriceUp: number;
  /** Price now must be at least this share of the window high. */
  nearHigh: number;
  /** Largest single buyer's share of window buy SOL (wash-trade filter). */
  maxBuyerShare: number;
  /** Real SOL reserve band a coin must sit in to be buyable. */
  minRqSol: number;
  maxRqSol: number;
  /** Youngest age (slots since CreateEvent) at which a coin may be bought. */
  minAge: number;
  /** Oldest age at which a first buy may still be decided. */
  maxAgeFirst: number;
  /** First (and usually only) buy size, SOL. */
  initialSol: number;
  /** Size of each pyramid add, SOL (0 = no adds). */
  addSol: number;
  /** Most SOL at cost in one coin. */
  maxStakeSol: number;
  /** Slots between pyramid adds on one coin. */
  addStep: number;
  /** Add only while price is at least this far above the entry price. */
  addIfUp: number;
  /** Buy slippage allowed, bps. */
  buySlipBps: number;
  /** Sell half the position at this gain. */
  takeProfit1: number;
  /** Sell half of what is left at this gain (rest rides). */
  takeProfit2: number;
  /** Hard stop: sell everything at this loss. */
  stopLoss: number;
  /** Trailing stop arms once a position is this far up. */
  trailArm: number;
  /** Trailing stop gives back at most this much from the peak gain. */
  trailGiveback: number;
  /** Fade exit: net SOL over the fade window at or below this. */
  fadeWindow: number;
  fadeNetSol: number;
  /** One sell trade this big on a held coin exits the whole position. */
  bigSellSol: number;
  /** Max slots to hold a position. */
  maxHold: number;
  /** Slots of cooldown after a full exit before the coin may re-enter. */
  cooldown: number;
  /** Most entries (first buys) per coin over the whole run. */
  maxEntries: number;
  /** Longer lookback (slots) whose high the price must be near: a breakout, not a bounce. 0 = off. */
  breakoutWindow: number;
  /** Price now at least this share of the breakout window's high. */
  breakoutNear: number;
  /** Slippage allowed on sells into strength (take-profit tranches). */
  tpSlipBps: number;
  /** Exit the whole position when the creator sells any amount. */
  exitOnCreatorSell: boolean;
  /** Most SOL at cost across all positions at once. */
  maxExposureSol: number;
  /** Cash never spent below this, SOL (keeps tx fees covered). */
  minCashSol: number;
}

export const DEFAULT_PARAMS: Params = {
  window: 40,
  minNetSol: 0.4,
  minBuys: 5,
  minBuyers: 5,
  minPriceUp: 0.03,
  maxPriceUp: 0.9,
  nearHigh: 0.97,
  maxBuyerShare: 0.7,
  minRqSol: 1.0,
  maxRqSol: 60,
  minAge: 250,
  maxAgeFirst: 1500,
  initialSol: 0.015,
  addSol: 0,
  maxStakeSol: 0.015,
  addStep: 30,
  addIfUp: 0.05,
  buySlipBps: 50,
  breakoutWindow: 0,
  breakoutNear: 0.98,
  tpSlipBps: 300,
  takeProfit1: 0.25,
  takeProfit2: 1.0,
  stopLoss: 0.08,
  trailArm: 0.25,
  trailGiveback: 0.3,
  fadeWindow: 10,
  fadeNetSol: -0.1,
  bigSellSol: 0.8,
  exitOnCreatorSell: false,
  maxHold: 1200,
  cooldown: 120,
  maxEntries: 1,
  maxExposureSol: 7,
  minCashSol: 0.2,
};

const SOL = 1e9;

interface Tick {
  slot: number;
  buy: boolean;
  /** SOL moved, in lamports. */
  lamports: number;
  /** Price at this trade: virtual quote / virtual token reserves. */
  px: number;
  who: string;
}

interface Coin {
  born: number | null;
  maker: string;
  ticks: Tick[];
  /** Slot the position was first seen as a fill (0 = never held). */
  entrySlot: number;
  /** SOL paid per token at entry (cost / tokens). */
  entryPx: number;
  /** Best gain seen since entry (fraction). */
  best: number;
  tp1: boolean;
  tp2: boolean;
  /** First buys sent for this coin. */
  tries: number;
  /** Slot of the last full exit (0 = never exited). */
  exitedAt: number;
  /** Slot of the last pyramid add (0 = none). */
  addedAt: number;
  /** True while the harness reports a position in this coin. */
  live: boolean;
}

/** Price of a curve now from the batch marks, SOL per token; 0 when unknown. */
function pxNow(marks: Map<Pubkey, Mark>, mint: Pubkey): number {
  const m = marks.get(mint);
  if (m === undefined || BigInt(m.virtual_token_reserves) === 0n) return 0;
  return Number(BigInt(m.virtual_quote_reserves)) / Number(BigInt(m.virtual_token_reserves));
}

/** Gross mark value of `tokens` at the current curve price (no fees,
 *  no price impact): the same basis the stop and take-profit levels
 *  are measured against. */
function grossWorth(marks: Map<Pubkey, Mark>, mint: Pubkey, tokens: bigint): bigint {
  const m = marks.get(mint);
  if (m === undefined) return 0n;
  const vq = BigInt(m.virtual_quote_reserves);
  const vt = BigInt(m.virtual_token_reserves);
  if (vt === 0n || tokens === 0n) return 0n;
  return (tokens * vq) / vt;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const coins = new Map<Pubkey, Coin>();
  const liveSet = new Set<Pubkey>();
  const done = new Set<Pubkey>();
  /** Take-profit sells in flight, by client_id: a rejected one re-arms its tranche. */
  const inflightTp = new Map<string, { mint: Pubkey; stage: 1 | 2 }>();
  let tpN = 0;
  let startSlot = -1;
  let equityPeak = 0n;
  let paused = false;
  /** Coins ever entered (first buys sent): the breadth the tier watches. */
  let entered = 0;

  function coinFor(mint: Pubkey): Coin {
    let c = coins.get(mint);
    if (c === undefined) {
      c = { born: null, maker: '', ticks: [], entrySlot: 0, entryPx: 0, best: 0, tp1: false, tp2: false, tries: 0, exitedAt: 0, addedAt: 0, live: false };
      coins.set(mint, c);
    }
    return c;
  }

  /** Net SOL flow over the last `span` slots, plus buy count and buy volume. */
  function netFlow(c: Coin, now: number, span: number): { net: number; n: number; vol: number } {
    let net = 0;
    let n = 0;
    let vol = 0;
    for (let i = c.ticks.length - 1; i >= 0; i--) {
      const t = c.ticks[i]!;
      if (t.slot <= now - span) break;
      if (t.buy) {
        net += t.lamports;
        n++;
        vol += t.lamports;
      } else {
        net -= t.lamports;
      }
    }
    return { net, n, vol };
  }

  /** Does this coin pass the entry bar right now? One pass over the window. */
  function entryOk(c: Coin, now: number, tier: number): boolean {
    const cut = now - p.window;
    let firstPx = 0;
    let top = 0;
    let lastPx = 0;
    let buys = 0;
    let net = 0;
    let buyVol = 0;
    const buyers = new Set<string>();
    const perBuyer = new Map<string, number>();
    for (const t of c.ticks) {
      if (t.slot <= cut) continue;
      if (firstPx === 0) firstPx = t.px;
      lastPx = t.px;
      if (t.px > top) top = t.px;
      if (!t.buy) {
        net -= t.lamports;
        continue;
      }
      buys++;
      net += t.lamports;
      buyVol += t.lamports;
      buyers.add(t.who);
      perBuyer.set(t.who, (perBuyer.get(t.who) ?? 0) + t.lamports);
    }
    if (firstPx === 0 || lastPx === 0 || buys === 0) return false;
    const rise = lastPx / firstPx - 1;
    const needNet = tier === 0 ? p.minNetSol : tier === 1 ? 0.15 : 0.08;
    const needBuys = tier === 0 ? p.minBuys : tier === 1 ? 3 : 2;
    const needBuyers = tier === 0 ? p.minBuyers : tier === 1 ? 3 : 2;
    const needRise = tier === 0 ? p.minPriceUp : tier === 1 ? 0.015 : 0.008;
    let biggest = 0;
    for (const v of perBuyer.values()) if (buyVol > 0 && v / buyVol > biggest) biggest = v / buyVol;
    if (p.breakoutWindow > 0) {
      let longTop = 0;
      for (let i = c.ticks.length - 1; i >= 0; i--) {
        const t = c.ticks[i]!;
        if (t.slot <= now - p.breakoutWindow) break;
        if (t.px > longTop) longTop = t.px;
      }
      if (longTop === 0 || lastPx < p.breakoutNear * longTop) return false;
    }
    return (
      net / SOL >= needNet &&
      buys >= needBuys &&
      buyers.size >= needBuyers &&
      rise >= needRise &&
      rise <= p.maxPriceUp &&
      lastPx >= p.nearHigh * top &&
      biggest <= p.maxBuyerShare
    );
  }

  /** Pick the exit for a held coin, if any. Returns the tokens to sell, the
   *  slippage to allow, and the take-profit stage (0 = not a take-profit). */
  function pickExit(
    c: Coin,
    now: number,
    tokens: bigint,
    cost: bigint,
    marks: Map<Pubkey, Mark>,
    mint: Pubkey,
  ): { amount: bigint; slip: number; stage: 0 | 1 | 2 } | null {
    const px = pxNow(marks, mint);
    if (px === 0 || cost === 0n) return null;
    const value = grossWorth(marks, mint, tokens);
    const gain = Number(value) / Number(cost) - 1;
    if (gain > c.best) c.best = gain;
    if (!c.tp1 && gain >= p.takeProfit1) {
      c.tp1 = true;
      return { amount: tokens / 2n, slip: p.tpSlipBps, stage: 1 };
    }
    if (c.tp1 && !c.tp2 && gain >= p.takeProfit2) {
      c.tp2 = true;
      return { amount: tokens / 2n, slip: p.tpSlipBps, stage: 2 };
    }
    if (gain <= -p.stopLoss) return { amount: tokens, slip: 10_000, stage: 0 };
    if (c.best >= p.trailArm && gain <= c.best - p.trailGiveback) {
      return { amount: tokens, slip: 10_000, stage: 0 };
    }
    if (now - c.entrySlot >= p.maxHold) return { amount: tokens, slip: 10_000, stage: 0 };
    // Fade: money leaving fast, one whale dumping, or the maker selling.
    const f = netFlow(c, now, p.fadeWindow);
    let whale = false;
    let makerSold = false;
    for (let i = c.ticks.length - 1; i >= 0; i--) {
      const t = c.ticks[i]!;
      if (t.slot <= now - p.fadeWindow) break;
      if (t.buy) continue;
      if (t.lamports / SOL >= p.bigSellSol) whale = true;
      if (p.exitOnCreatorSell && c.maker !== '' && t.who === c.maker) makerSold = true;
    }
    if (f.net / SOL <= p.fadeNetSol || whale || makerSold) {
      return { amount: tokens, slip: 10_000, stage: 0 };
    }
    return null;
  }

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = state.slot;
      if (startSlot < 0) startSlot = now;
      const tx = state.txFeeLamports();
      const orders: OrderInput[] = [];
      const { caps } = state.hello;
      const marks = new Map<Pubkey, Mark>();
      for (const m of batch.marks) marks.set(m.mint, m);

      // 1. Fold this batch's events into the per-coin tapes.
      const touched: Pubkey[] = [];
      const seenTouched = new Set<Pubkey>();
      const touch = (mint: Pubkey) => {
        if (!seenTouched.has(mint)) {
          seenTouched.add(mint);
          touched.push(mint);
        }
      };
      for (const e of batch.events) {
        if (e.event === 'CreateEvent') {
          const c = coinFor(e.mint);
          c.born = e.slot;
          c.maker = e.creator;
          touch(e.mint);
        } else if (e.event === 'TradeEvent') {
          const c = coinFor(e.mint);
          const vt = BigInt(e.virtual_token_reserves);
          c.ticks.push({
            slot: e.slot,
            buy: e.is_buy,
            lamports: Number(e.sol_amount),
            px: vt === 0n ? 0 : Number(BigInt(e.virtual_quote_reserves)) / Number(vt),
            who: e.user,
          });
          touch(e.mint);
        } else {
          touch(e.mint);
        }
      }
      // Drop ticks older than any lookback we use.
      const keepFrom = now - (Math.max(p.window, p.fadeWindow, p.breakoutWindow) + 5);
      for (const mint of touched) {
        const c = coins.get(mint);
        if (c === undefined) continue;
        let cut = 0;
        while (cut < c.ticks.length && c.ticks[cut]!.slot <= keepFrom) cut++;
        if (cut > 0) c.ticks.splice(0, cut);
      }

      // 1b. A take-profit sell that came back rejected re-arms its tranche.
      for (const f of batch.fills) {
        const tp = inflightTp.get(f.client_id);
        if (tp === undefined) continue;
        inflightTp.delete(f.client_id);
        if (f.status === 'rejected') {
          const c = coins.get(tp.mint);
          if (c !== undefined) {
            if (tp.stage === 1) c.tp1 = false;
            else c.tp2 = false;
          }
        }
      }

      // 2. Sync coin records with the positions the harness reports.
      const heldNow = new Set<Pubkey>();
      let exposure = 0n;
      for (const [mint, pos] of state.positions) {
        heldNow.add(mint);
        exposure += pos.cost_lamports;
        const c = coinFor(mint);
        if (!c.live) {
          const n = Number(pos.token_amount);
          c.entrySlot = now;
          c.entryPx = n > 0 ? Number(pos.cost_lamports) / n : 0;
          c.best = 0;
          c.tp1 = false;
          c.tp2 = false;
          c.live = true;
          if (c.tries === 0) c.tries = 1;
        }
      }
      for (const mint of [...liveSet]) {
        if (heldNow.has(mint)) continue;
        const c = coins.get(mint);
        if (c !== undefined) {
          c.live = false;
          c.exitedAt = now;
          c.tp1 = false;
          c.tp2 = false;
          c.best = 0;
          c.addedAt = 0;
        }
        liveSet.delete(mint);
      }
      for (const mint of heldNow) liveSet.add(mint);

      // 3. Equity + drawdown guard. Peak equity is cash plus mark value.
      let equity = state.cash;
      for (const [mint, pos] of state.positions) {
        equity += grossWorth(marks, mint, pos.token_amount);
      }
      if (equity > equityPeak) equityPeak = equity;
      if (equityPeak === 0n) equityPeak = equity;
      if (paused) {
        if (equity * 4n >= equityPeak * 3n) paused = false;
      } else if (equityPeak > 0n && equity * 20n < equityPeak * 13n) {
        paused = true;
      }

      // Breadth insurance: loosen the bar on a fixed slot schedule when
      // coins are tracking below the 20-coin bar. Calibrated to a 6-hour
      // final window (~100k slots); never triggers on the 24h dev window.
      const elapsed = now - startSlot;
      const tier = elapsed >= 80_000 && entered < 16 ? 2 : elapsed >= 50_000 && entered < 12 ? 1 : 0;

      const sellPending = new Set<Pubkey>();
      const buyPending = new Set<Pubkey>();
      for (const po of state.pending.values()) {
        if (po.order.side === 'sell') sellPending.add(po.order.mint);
        else buyPending.add(po.order.mint);
      }

      // 4. Exits first.
      for (const [mint, pos] of state.positions) {
        if (sellPending.has(mint)) continue;
        const c = coins.get(mint);
        if (c === undefined) continue;
        const exit = pickExit(c, now, pos.token_amount, pos.cost_lamports, marks, mint);
        if (exit === null || exit.amount <= 0n) continue;
        if (orders.length >= caps.max_orders_per_batch) break;
        if (exit.stage !== 0) {
          const cid = `tp${exit.stage}-${mint.slice(0, 8)}-${tpN++}`;
          inflightTp.set(cid, { mint, stage: exit.stage });
          orders.push({ side: 'sell', mint, token_amount: exit.amount, max_slippage_bps: exit.slip, client_id: cid });
        } else {
          orders.push({ side: 'sell', mint, token_amount: exit.amount, max_slippage_bps: exit.slip });
        }
      }

      // 5. Pyramid adds (off by default: addSol 0 means one clean entry).
      if (!paused && p.addSol > 0) {
        for (const [mint, pos] of state.positions) {
          if (orders.length >= caps.max_orders_per_batch) break;
          if (buyPending.has(mint) || sellPending.has(mint)) continue;
          const c = coins.get(mint);
          if (c === undefined) continue;
          const invested = Number(pos.cost_lamports) / SOL;
          if (invested >= p.maxStakeSol - 0.005) continue;
          if (c.addedAt !== 0 && now - c.addedAt < p.addStep) continue;
          const px = pxNow(marks, mint);
          if (px === 0 || c.entryPx === 0 || px < c.entryPx * (1 + p.addIfUp)) continue;
          if (!entryOk(c, now, tier)) continue;
          const cap = state.maxBuyLamports(mint);
          if (cap <= 0n) continue;
          const want = BigInt(Math.floor(Math.min(p.addSol, p.maxStakeSol - invested) * SOL));
          const amount = want < cap ? want : cap;
          if (amount < BigInt(Math.floor(0.01 * SOL))) continue;
          if (state.freeCashLamports() < amount + tx) continue;
          if (exposure + amount > BigInt(Math.floor(p.maxExposureSol * SOL))) continue;
          orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlipBps });
          exposure += amount;
          c.addedAt = now;
          buyPending.add(mint);
        }
      }

      // 6. First buys, in the order coins traded this batch.
      if (!paused) {
        let free = state.freeCashLamports();
        for (const o of orders) {
          free -= tx;
          if (o.side === 'buy') free -= BigInt(o.quote_lamports);
        }
        let room = caps.max_open_positions - state.committedPositionCount();
        for (const o of orders) if (o.side === 'buy') room -= 1;
        for (const e of batch.events) {
          if (orders.length >= caps.max_orders_per_batch || room <= 0) break;
          if (e.event !== 'TradeEvent' && e.event !== 'CreateEvent') continue;
          const mint = e.mint;
          if (done.has(mint) || state.positions.has(mint) || buyPending.has(mint)) continue;
          const curve = state.curves.get(mint);
          if (curve === undefined || curve.complete) {
            done.add(mint);
            continue;
          }
          const c = coins.get(mint);
          if (c === undefined || c.born === null) continue;
          const age = now - c.born;
          if (age < p.minAge) continue;
          if (age > p.maxAgeFirst) {
            done.add(mint);
            continue;
          }
          const rq = Number(curve.real_quote_reserves) / SOL;
          if (rq < p.minRqSol || rq > p.maxRqSol) continue;
          if (c.tries >= p.maxEntries) {
            done.add(mint);
            continue;
          }
          if (c.exitedAt !== 0 && now - c.exitedAt < p.cooldown) continue;
          if (!entryOk(c, now, tier)) continue;
          const cap = state.maxBuyLamports(mint);
          if (cap <= 0n) continue;
          const want = BigInt(Math.floor(p.initialSol * SOL));
          const amount = want < cap ? want : cap;
          if (amount < BigInt(Math.floor(0.01 * SOL))) continue;
          if (free < amount + tx) continue;
          if (exposure + amount > BigInt(Math.floor(p.maxExposureSol * SOL))) continue;
          if (state.cash - amount - tx < BigInt(Math.floor(p.minCashSol * SOL))) continue;
          orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlipBps });
          free -= amount + tx;
          exposure += amount;
          room -= 1;
          buyPending.add(mint);
          c.tries += 1;
          entered += 1;
        }
      }

      return orders;
    },
  };
}
