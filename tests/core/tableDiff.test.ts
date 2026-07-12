import { describe, it, expect } from "vitest";
import { diffTable, type TableMatrix } from "../../src/core/diff/tableDiff";

// テーブルのセル単位差分。純関数（行列入力）。
// L0 同形セル編集 / L1 行追加・削除 / L2 列増減 / 空表・1セル境界 を固定する。

describe("diffTable — L0（列数一致・行数一致）", () => {
  it("flags only changed cells with word-level ops", () => {
    const prev: TableMatrix = [
      ["氏名", "年齢"],
      ["田中", "30"],
    ];
    const next: TableMatrix = [
      ["氏名", "年齢"],
      ["田中", "31"],
    ];

    const result = diffTable(prev, next);

    expect(result.degraded).toBe(false);
    expect(result.insertedRows).toEqual([]);
    expect(result.deletedRows).toEqual([]);
    // 変更があったのは (row1, col1) の年齢セルのみ。
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0]).toMatchObject({ nextRow: 1, col: 1 });
  });

  it("emits no cell diffs when tables are identical", () => {
    const m: TableMatrix = [
      ["a", "b"],
      ["c", "d"],
    ];

    const result = diffTable(m, m);

    expect(result.degraded).toBe(false);
    expect(result.cells).toHaveLength(0);
  });
});

describe("diffTable — L1（列数一致・行数相違）", () => {
  it("detects an inserted row", () => {
    const prev: TableMatrix = [
      ["h1", "h2"],
      ["a", "b"],
    ];
    const next: TableMatrix = [
      ["h1", "h2"],
      ["a", "b"],
      ["c", "d"],
    ];

    const result = diffTable(prev, next);

    expect(result.degraded).toBe(false);
    expect(result.insertedRows).toEqual([2]);
    expect(result.deletedRows).toEqual([]);
  });

  it("detects a deleted row", () => {
    const prev: TableMatrix = [
      ["h1", "h2"],
      ["a", "b"],
      ["c", "d"],
    ];
    const next: TableMatrix = [
      ["h1", "h2"],
      ["c", "d"],
    ];

    const result = diffTable(prev, next);

    expect(result.degraded).toBe(false);
    // prev の行 index 1（a,b）が削除。
    expect(result.deletedRows).toEqual([1]);
    expect(result.insertedRows).toEqual([]);
  });
});

describe("diffTable — L2（列数相違＝構造変化）", () => {
  it("degrades when column count differs", () => {
    const prev: TableMatrix = [["a", "b"]];
    const next: TableMatrix = [["a", "b", "c"]];

    const result = diffTable(prev, next);

    expect(result.degraded).toBe(true);
    expect(result.cells).toHaveLength(0);
  });
});

describe("diffTable — 境界", () => {
  it("handles empty matrices (no columns) without degrading", () => {
    const result = diffTable([], []);

    expect(result.degraded).toBe(false);
    expect(result.cells).toHaveLength(0);
  });

  it("diffs a single-cell table", () => {
    const result = diffTable([["old"]], [["new"]]);

    expect(result.degraded).toBe(false);
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0]).toMatchObject({ nextRow: 0, col: 0 });
  });
});
