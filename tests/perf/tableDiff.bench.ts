// テーブルのセル単位差分の計算遅延ベンチ（目標 <200ms）。
//
// diffTable は L0（同形セル編集）で Σ(セル積) ＋ 行 LCS。代表サイズで遅延を計測し、
// 閾値（MAX_TABLE_DIFF_COST）内では実用遅延に収まることを確認する。
// 純関数のため DOM 非依存（node 環境で計測）。

import { bench, describe } from "vitest";

import { diffTable } from "../../src/core/diff/tableDiff";
import { editedTable, tableOfSize, TABLE_SIZES } from "./fixtures";

describe("diffTable 計算遅延（目標 <200ms, L0 セル編集）", () => {
  for (const { rows, cols } of TABLE_SIZES) {
    const prev = tableOfSize(rows, cols);
    const next = editedTable(prev);
    bench(`${String(rows)}行×${String(cols)}列`, () => {
      diffTable(prev, next);
    });
  }
});
