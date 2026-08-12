// ComfyUI's Seed(rgthree) node caps at 2^50; matches server/comfyui.ts SEED_MAX.
// Duplicated here rather than shared because the server ships as an
// independent ESM package and no build step wires client and server sources
// together — keep both constants in lockstep when either side moves.
export const CLIENT_SEED_MAX = 1125899906842624;

// Given the user's "lock seed?" toggle state, returns the seed value to send
// to the server. When locked, the user's chosen value passes through as-is.
// When unlocked, a fresh non-negative random seed is minted so every
// generation varies — ComfyUI's Seed node has no "-1 = random" convention
// (unlike SD1111's txt2img), so relying on a sentinel value collapses to a
// fixed clampSeed(-1) === 1 on the server. randomFn is injectable for tests.
export function resolveVideoSeed(
  lockedValue: number,
  locked: boolean,
  randomFn: () => number = Math.random,
): number {
  if (locked) return lockedValue;
  return Math.floor(randomFn() * CLIENT_SEED_MAX);
}
