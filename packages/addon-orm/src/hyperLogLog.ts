/**
 * HyperLogLog: probabilistic cardinality estimator.
 * Standard dense-register implementation (Flajolet et al.), used to approximate
 * "how many distinct values" without holding the full distinct set in memory —
 * useful for `countDistinct` over large collections.
 */

const DEFAULT_PRECISION = 14; // 2^14 = 16384 registers, ~0.8% typical error

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * MurmurHash3 fmix32 finalizer. FNV-1a alone has weak avalanche on its high
 * bits for short/sequential inputs — those bits pick the register index, so a
 * biased index distribution skews every cardinality estimate. This spreads
 * entropy across all 32 bits before it's split into index/rank.
 */
function avalanche(hash: number): number {
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function hashValue(value: string): number {
  return avalanche(fnv1a(value));
}

function countLeadingZerosPlusOne(value: number, maxBits: number): number {
  if (value === 0) return maxBits + 1;
  let rank = 1;
  let bit = 1 << (maxBits - 1);
  while ((value & bit) === 0 && bit !== 0) {
    rank++;
    bit >>>= 1;
  }
  return rank;
}

function alpha(m: number): number {
  if (m === 16) return 0.673;
  if (m === 32) return 0.697;
  if (m === 64) return 0.709;
  return 0.7213 / (1 + 1.079 / m);
}

export class HyperLogLog {
  private readonly precision: number;
  private readonly m: number;
  private readonly registers: Uint8Array;
  private readonly indexBits: number;

  constructor(precision: number = DEFAULT_PRECISION) {
    this.precision = precision;
    this.m = 1 << precision;
    this.registers = new Uint8Array(this.m);
    this.indexBits = 32 - precision;
  }

  add(value: string): void {
    const hash = hashValue(value);
    const index = hash >>> this.indexBits;
    const remainder = (hash << this.precision) >>> this.precision;
    const rank = countLeadingZerosPlusOne(remainder, this.indexBits);
    if (rank > this.registers[index]) {
      this.registers[index] = rank;
    }
  }

  count(): number {
    const m = this.m;
    let sumInverse = 0;
    let zeroRegisters = 0;

    for (let i = 0; i < m; i++) {
      sumInverse += 1 / (1 << this.registers[i]);
      if (this.registers[i] === 0) zeroRegisters++;
    }

    const rawEstimate = (alpha(m) * m * m) / sumInverse;

    if (rawEstimate <= 2.5 * m && zeroRegisters > 0) {
      return Math.round(m * Math.log(m / zeroRegisters));
    }

    return Math.round(rawEstimate);
  }

  merge(other: HyperLogLog): HyperLogLog {
    if (other.m !== this.m) {
      throw new Error("HyperLogLog.merge: precision mismatch");
    }
    const merged = new HyperLogLog(this.precision);
    for (let i = 0; i < this.m; i++) {
      merged.registers[i] = Math.max(this.registers[i], other.registers[i]);
    }
    return merged;
  }
}

export function createHyperLogLog(precision?: number): HyperLogLog {
  return new HyperLogLog(precision);
}
