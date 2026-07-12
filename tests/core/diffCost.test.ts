import { describe, it, expect } from "vitest";
import {
  estimateDiffCost,
  shouldDegradeDiff,
  MAX_INLINE_DIFF_COST,
  MAX_TABLE_DIFF_COST,
  MAX_CELL_DIFF_COST,
} from "../../src/core/diff/diffCost";

// 差分コストガード。トークン積の概算と閾値境界を固定する。

describe("estimateDiffCost", () => {
  it("returns the product of token counts", () => {
    expect(estimateDiffCost(3, 4)).toBe(12);
  });

  it("returns 0 when either side has no tokens", () => {
    expect(estimateDiffCost(0, 100)).toBe(0);
    expect(estimateDiffCost(100, 0)).toBe(0);
  });
});

describe("shouldDegradeDiff（境界）", () => {
  it("does not degrade exactly at the threshold (boundary inclusive)", () => {
    expect(shouldDegradeDiff(MAX_INLINE_DIFF_COST, MAX_INLINE_DIFF_COST)).toBe(
      false,
    );
  });

  it("degrades just above the threshold", () => {
    expect(
      shouldDegradeDiff(MAX_INLINE_DIFF_COST + 1, MAX_INLINE_DIFF_COST),
    ).toBe(true);
  });

  it("does not degrade below the threshold", () => {
    expect(shouldDegradeDiff(0, MAX_CELL_DIFF_COST)).toBe(false);
  });
});

describe("閾値の大小関係（設計の前提）", () => {
  it("inline > table > cell の順に上限が小さくなる", () => {
    expect(MAX_INLINE_DIFF_COST).toBeGreaterThan(MAX_TABLE_DIFF_COST);
    expect(MAX_TABLE_DIFF_COST).toBeGreaterThan(MAX_CELL_DIFF_COST);
  });
});
