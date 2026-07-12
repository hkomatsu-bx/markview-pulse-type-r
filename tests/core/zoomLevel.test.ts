import { describe, it, expect } from "vitest";
import {
  ZOOM_LEVELS,
  DEFAULT_ZOOM_PERCENT,
  zoomIn,
  zoomOut,
  cycleZoom,
  resetZoom,
  zoomToScale,
  zoomPercentLabel,
} from "../../src/core/view/zoomLevel";

// 本文ズームのプリセット増減。純粋関数なので入出力のみ検証する。

const FIRST = ZOOM_LEVELS[0] ?? DEFAULT_ZOOM_PERCENT;
const LAST = ZOOM_LEVELS[ZOOM_LEVELS.length - 1] ?? DEFAULT_ZOOM_PERCENT;

describe("zoomLevel", () => {
  it("既定は 100% で、プリセット段に含まれる", () => {
    expect(DEFAULT_ZOOM_PERCENT).toBe(100);
    expect(ZOOM_LEVELS).toContain(100);
  });

  it("zoomIn は次の上段へ進む", () => {
    expect(zoomIn(100)).toBe(125);
  });

  it("zoomIn は最大段で頭打ちになる", () => {
    expect(zoomIn(LAST)).toBe(LAST);
  });

  it("zoomOut は次の下段へ進む", () => {
    expect(zoomOut(100)).toBe(75);
  });

  it("zoomOut は最小段で頭打ちになる", () => {
    expect(zoomOut(FIRST)).toBe(FIRST);
  });

  it("cycleZoom は順送りし、末尾から先頭へ折り返す", () => {
    expect(cycleZoom(LAST)).toBe(FIRST);
  });

  it("未知の段は既定へ寄せる（防御的）", () => {
    expect(zoomIn(133)).toBe(DEFAULT_ZOOM_PERCENT);
    expect(zoomOut(133)).toBe(DEFAULT_ZOOM_PERCENT);
    expect(cycleZoom(133)).toBe(FIRST);
  });

  it("resetZoom は既定を返す", () => {
    expect(resetZoom()).toBe(DEFAULT_ZOOM_PERCENT);
  });

  it("zoomToScale はパーセントを無次元倍率へ変換する", () => {
    expect(zoomToScale(150)).toBe(1.5);
    expect(zoomToScale(100)).toBe(1);
  });

  it("zoomPercentLabel はパーセント文字列を返す", () => {
    expect(zoomPercentLabel(125)).toBe("125%");
  });
});
