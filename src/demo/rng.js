// Deterministic PRNG so every "Run demo data" produces the same rehearsed
// dataset (reproducible), while still looking varied. mulberry32 is tiny and
// good enough for demo data. Seed is fixed; bump it only to reshuffle.
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A single shared generator, re-created on each seed run.
let rand = mulberry32(20240820)
export function resetRng(seed = 20240820) {
  rand = mulberry32(seed)
}

export const rng = {
  // float in [min, max)
  float: (min, max) => min + rand() * (max - min),
  // int in [min, max] inclusive
  int: (min, max) => Math.floor(min + rand() * (max - min + 1)),
  // pick one element
  pick: (arr) => arr[Math.floor(rand() * arr.length)],
  // n distinct picks (or fewer if array is smaller)
  sample: (arr, n) => {
    const copy = arr.slice()
    const out = []
    while (out.length < n && copy.length) {
      out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0])
    }
    return out
  },
  // true with probability p
  chance: (p) => rand() < p,
  // round to 2 decimals
  money: (min, max) => Math.round((min + rand() * (max - min)) * 100) / 100,
}
