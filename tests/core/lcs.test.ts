import { describe, it, expect } from "vitest";

import { lcsAlign, type LcsStep } from "../../src/core/diff/lcs";

// LCS 汎用プリミティブ（diffEngine / tableDiff が共有）。
// equal=両列消費 / delete=a 消費 / insert=b 消費。同点（>=）は delete 優先。

describe("lcsAlign", () => {
  it("両方が空なら空のステップ列", () => {
    expect(lcsAlign([], [])).toEqual([]);
  });

  it("完全一致は全て equal（添字対応）", () => {
    expect(lcsAlign(["a", "b", "c"], ["a", "b", "c"])).toEqual<LcsStep[]>([
      { kind: "equal", a: 0, b: 0 },
      { kind: "equal", a: 1, b: 1 },
      { kind: "equal", a: 2, b: 2 },
    ]);
  });

  it("a だけが空なら全て insert", () => {
    expect(lcsAlign([], ["x", "y"])).toEqual<LcsStep[]>([
      { kind: "insert", b: 0 },
      { kind: "insert", b: 1 },
    ]);
  });

  it("b だけが空なら全て delete", () => {
    expect(lcsAlign(["x", "y"], [])).toEqual<LcsStep[]>([
      { kind: "delete", a: 0 },
      { kind: "delete", a: 1 },
    ]);
  });

  it("中間の置換は delete→insert（同点は delete 優先）", () => {
    // "a X c" → "a Y c": X を消し Y を入れる。共通部分 a, c は equal。
    expect(lcsAlign(["a", "X", "c"], ["a", "Y", "c"])).toEqual<LcsStep[]>([
      { kind: "equal", a: 0, b: 0 },
      { kind: "delete", a: 1 },
      { kind: "insert", b: 1 },
      { kind: "equal", a: 2, b: 2 },
    ]);
  });

  it("挿入のみ・削除のみを正しく検出する", () => {
    // "a c" → "a b c": b を挿入。
    expect(lcsAlign(["a", "c"], ["a", "b", "c"])).toEqual<LcsStep[]>([
      { kind: "equal", a: 0, b: 0 },
      { kind: "insert", b: 1 },
      { kind: "equal", a: 1, b: 2 },
    ]);
  });

  it("カスタム等価判定（大文字小文字無視）を使える", () => {
    const eq = (x: string, y: string): boolean =>
      x.toLowerCase() === y.toLowerCase();
    expect(lcsAlign(["A"], ["a"], eq)).toEqual<LcsStep[]>([
      { kind: "equal", a: 0, b: 0 },
    ]);
  });

  it("数値列など任意型に対して動作する", () => {
    expect(lcsAlign([1, 2], [1, 3])).toEqual<LcsStep[]>([
      { kind: "equal", a: 0, b: 0 },
      { kind: "delete", a: 1 },
      { kind: "insert", b: 1 },
    ]);
  });
});
