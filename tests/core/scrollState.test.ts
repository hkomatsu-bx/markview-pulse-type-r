import { describe, it, expect } from "vitest";

import {
  createScrollPositions,
  setScrollPosition,
  getScrollPosition,
  removeScrollPosition,
  preserveScrollRatio,
} from "../../src/core/view/scrollState";

describe("ScrollPositions の不変更新（FR-13）", () => {
  it("set は新しいマップを返し元を破壊しない", () => {
    // Arrange
    const initial = createScrollPositions();

    // Act
    const next = setScrollPosition(initial, "tab-1", 120);

    // Assert
    expect(getScrollPosition(next, "tab-1")).toBe(120);
    expect(initial.has("tab-1")).toBe(false);
  });

  it("未記録の id は 0 を返す", () => {
    const positions = createScrollPositions();

    expect(getScrollPosition(positions, "tab-x")).toBe(0);
  });

  it("remove は該当 id を除いた新しいマップを返す", () => {
    const positions = setScrollPosition(createScrollPositions(), "tab-1", 80);

    const next = removeScrollPosition(positions, "tab-1");

    expect(next.has("tab-1")).toBe(false);
    expect(positions.has("tab-1")).toBe(true);
  });

  it("remove は未記録 id では同一参照を返す", () => {
    const positions = createScrollPositions();

    expect(removeScrollPosition(positions, "tab-x")).toBe(positions);
  });
});

describe("preserveScrollRatio（FR-13 × FR-02）", () => {
  it("高さ拡大時に比率を保ってスクロール位置を拡大する", () => {
    // 50% の位置 → 拡大後も 50%
    expect(preserveScrollRatio(100, 200, 400)).toBe(200);
  });

  it("高さ縮小時に比率を保って縮小する", () => {
    expect(preserveScrollRatio(100, 400, 200)).toBe(50);
  });

  it("前回高さが 0 以下なら 0 を返す（ゼロ除算ガード）", () => {
    expect(preserveScrollRatio(100, 0, 400)).toBe(0);
  });

  it("新しい高さが 0 以下なら 0 を返す", () => {
    expect(preserveScrollRatio(100, 200, 0)).toBe(0);
  });
});
