// The farm-plan generator: one protocol's record in, the steps to farm it out.
//
// The plan is derived from the protocol's own snapshot figures — its category decides the main
// action, its chains decide the gas budget, its TVL decides the capital band, and its age plus
// seven-day growth decide the pacing. Nothing is keyed to a protocol name; the same function writes
// every plan. Costs are honest estimates (gas by chain class, capital by TVL band) — the snapshot
// carries no yield data, so no plan ever quotes one.

import type { SnapshotProtocol } from './model.ts';

/** The gas budget one action costs on a protocol's main chain, as an honest range. */
export function gasBand(chains: string[]): string {
  const main = chains.length > 0 ? chains[0]! : '';
  if (main === 'Ethereum') return '$4–25 of gas per action';
  if (main === 'Solana' || main === 'Algorand' || main === 'Stellar' || main === 'Flare' || main === 'Tron') return 'under $0.10 of fees per action';
  if (main === 'Bitcoin' || main === 'Lightning Network' || main === 'Stacks' || main === 'BSquared' || main === 'Babylon Genesis' || main === 'CORE' || main === 'Fractal Bitcoin') return '$1–6 of BTC fees per action';
  if (main === 'Bittensor' || main === 'Noble' || main === 'Mezo' || main === 'Pharos' || main === 'Arc' || main === 'Robinhood Chain') return 'under $0.50 of fees per action';
  // Every major rollup and alt-L1 this snapshot names — Arbitrum, Base, Optimism, Polygon, Monad,
  // Ink, Plasma, Unichain and their kin — prices a simple action in cents.
  return '$0.05–1 of gas per action';
}

/** The capital band a protocol's TVL supports, so a reader sizes a position that fits the pool. */
export function capitalBand(tvl: number): { low: number; high: number } {
  if (tvl >= 5_000_000_000) return { low: 250, high: 500 };
  if (tvl >= 1_000_000_000) return { low: 150, high: 300 };
  if (tvl >= 100_000_000) return { low: 100, high: 200 };
  return { low: 50, high: 100 };
}

/** The category's main action, in words a farmer can follow, with the protocol's own figures in it. */
export function mainAction(p: SnapshotProtocol, chain: string, cap: { low: number; high: number }): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const money = `$${cap.low}–${cap.high}`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply ${money} of USDC into ${name}'s lending market on ${chain}, leave it borrowed-against or idle as the market allows, and keep the deposit receipt.`;
  if (c.includes('dex') || c.includes('swap') || c.includes('otc')) return `Provide ${money} of two-sided liquidity to ${name}'s deepest pool on ${chain} and leave both sides in place through the fee snapshots.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('aggregator') || c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Deposit ${money} into a ${name} vault on ${chain}, keep the vault shares, and let the allocation do the weekly work for you.`;
  if (c.includes('rwa')) return `Mint ${money} of ${name}'s yield-bearing asset on ${chain} and hold the position, so your address is in the holder set if a token is granted retroactively.`;
  if (c.includes('derivative') || c.includes('perp') || c.includes('options') || c.includes('interest rate')) return `Deposit ${money} as margin on ${name}, open one small position, and keep the account active on ${chain} without leverage above 2x.`;
  if (c.includes('insurance') || c.includes('cover')) return `Buy ${money} of cover from ${name} on ${chain} and keep the policy alive; underwriting activity is the role this protocol rewards.`;
  if (c.includes('basis')) return `Run ${money} through one ${name} basis position on ${chain} — long spot, short the perp — and roll it on schedule rather than closing early.`;
  if (c.includes('prediction')) return `Fund ${money} on ${name} and take one position in an active market, then keep trading small so your volume is recorded.`;
  if (c.includes('stable')) return `Mint or deposit ${money} of the stable asset through ${name} on ${chain} and keep the balance in the protocol rather than in a wallet.`;
  if (c.includes('chain')) return `Become an active user of ${name}: bridge in ${money} of value, swap on its native dex, and stake through its native staking so activity shows across its apps.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake ${money} of the chain's asset through ${name} on ${chain} and keep the receipt token in your own wallet, never in a pooled wrapper.`;
  if (c.includes('payment') || c.includes('card') || c.includes('privacy')) return `Route ${money} of real payments or transfers through ${name} each month, since usage volume is the metric a payments protocol can reward.`;
  if (c.includes('leverag')) return `Open one ${money} leveraged position on ${name} on ${chain}, keep it healthy, and avoid liquidation through the whole farming window.`;
  if (c.includes('liquidity')) return `Deposit ${money} into ${name}'s managed liquidity on ${chain} and leave the position untouched while the manager rebalances.`;
  if (c.includes('collateral markets')) return `Supply ${money} of the accepted collateral to ${name}'s markets on ${chain} and keep the position open through at least two reward periods.`;
  if (c.includes('governance') || c.includes('incentive')) return `Deposit ${money} into ${name}'s incentive program on ${chain} and vote with the position every epoch it allows.`;
  if (c.includes('wrapper')) return `Mint ${money} of ${name}'s wrapped asset on ${chain}, use it in one downstream app, and keep the mint transaction as your on-chain record.`;
  return `Deposit ${money} of USDC into ${name} on ${chain} and keep the position open, making one additional action each week the app supports.`;
}

/** How long to hold, from the protocol's age with no token. */
export function holdWindow(age: number | null): string {
  if (age === null) return '30–45 days';
  if (age < 180) return "60–90 days, through the protocol's first snapshot seasons";
  if (age < 730) return '45–60 days, well inside the window retroactive rewards tend to measure';
  return '30–45 days at reduced size, since a protocol this old may reward only fresh activity';
}

/** One string with cost and time, within the gate's 20..600 characters. */
function step(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Confirm every step on the protocol's own site first.`;
  return s;
}

/** The farm plan: seven concrete steps, each with a cost and a time, derived from the protocol's record. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const cap = capitalBand(p.tvl_usd);
  const gas = gasBand(p.chains);
  const growthNote =
    p.change_7d === null
      ? 'Growth is unreported for the last seven days, so treat the trend as flat.'
      : p.change_7d >= 10
        ? `TVL is up ${p.change_7d.toFixed(1)}% on the week — flows are arriving, so start now rather than after the next snapshot.`
        : p.change_7d <= -10
          ? `TVL is down ${Math.abs(p.change_7d).toFixed(1)}% on the week — enter at half size and add the rest once flows stabilize.`
          : 'Weekly flows are steady, so size the position normally.';
  const hold = holdWindow(age);
  const steps = [
    step(
      'Set up a fresh wallet for this farm and keep its seed phrase offline; fund it only with what you plan to deploy.',
      'nothing but the transfer',
      '10 minutes',
    ),
    step(mainAction(p, chain, cap), `${cap.low}–${cap.high} dollars of capital plus ${gas}`, '20–40 minutes including approvals'),
    step(
      `Keep the position a small share of the pool — at ${p.name}'s TVL of $${Math.round(p.tvl_usd / 1e6)}M any retail size stays under half a percent of depth. ${growthNote}`,
      'no extra cost',
      '5 minutes to size',
    ),
    step(
      `Make one qualifying action each week — a top-up, a swap, a vote or a small borrow — so the address stays active across reward snapshots.`,
      `about $2–10 of gas a week on ${chain}`,
      '10 minutes a week',
    ),
    step(`Hold the position for ${hold}.`, `the $${cap.low}–${cap.high} stays deployed`, hold.split(',')[0]!),
    step(
      `Watch ${p.name}'s own announcements for a token or points program, and claim only from links published on its own domain — never from a message or a search ad.`,
      'nothing; never pay to claim',
      '5 minutes a week',
    ),
    step(
      'Log the wallet, dates, amounts and every transaction hash, so eligibility is provable when a program opens and the unwind is repeatable.',
      'nothing but the log',
      '5 minutes',
    ),
    step(
      'When a token launches, claim under its published rules, then decide hold versus sell from its vesting schedule, not from the first candle.',
      'claim gas only',
      '30 minutes at launch',
    ),
  ];
  return steps;
}
