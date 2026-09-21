import { describe, it, expect } from "vitest";
import { HyperLogLog } from "../src/hyperLogLog";

describe("HyperLogLog", () => {
  it("estimates cardinality within a reasonable error margin", () => {
    const hll = new HyperLogLog();
    const distinctCount = 10_000;

    for (let i = 0; i < distinctCount; i++) {
      hll.add(`item-${i}`);
    }

    const estimate = hll.count();
    const errorRatio = Math.abs(estimate - distinctCount) / distinctCount;
    expect(errorRatio).toBeLessThan(0.05); // within 5%
  });

  it("doesn't grow past the true count when the same values are added repeatedly", () => {
    const hll = new HyperLogLog();
    for (let i = 0; i < 1000; i++) {
      hll.add(`repeat-${i % 50}`); // only 50 distinct values
    }

    const estimate = hll.count();
    expect(estimate).toBeGreaterThan(30);
    expect(estimate).toBeLessThan(80);
  });

  it("merge() combines two HyperLogLogs into a union estimate", () => {
    const a = new HyperLogLog();
    const b = new HyperLogLog();

    for (let i = 0; i < 5000; i++) a.add(`a-${i}`);
    for (let i = 0; i < 5000; i++) b.add(`b-${i}`);

    const merged = a.merge(b);
    const errorRatio = Math.abs(merged.count() - 10_000) / 10_000;
    expect(errorRatio).toBeLessThan(0.05);
  });

  it("throws when merging HyperLogLogs of different precision", () => {
    const a = new HyperLogLog(10);
    const b = new HyperLogLog(12);
    expect(() => a.merge(b)).toThrow(/precision mismatch/);
  });
});
