// テーブルのセル単位差分。
//
// 行×セルのテキスト行列（TableMatrix）を入力に取る純関数。DOM 抽出は呼び出し側
// （diffDom）の責務とし、本モジュールは DOM/Tauri に非依存（単体テスト対象）。
//
// 縮退ラダー:
//   L0 列数一致・行数一致 → index 対応で per-cell 語差分（変更セルのみ）
//   L1 列数一致・行数相違 → 行 LCS（match→per-cell / insert→全セル / delete→幻行）
//   L2 列数相違（構造変化）→ degraded=true（呼び出し側がテキスト退化へ委譲）

import type { DiffOp } from "../../types";
import { diff, countTokens } from "./diffEngine";
import { lcsAlign } from "./lcs";
import {
  estimateDiffCost,
  shouldDegradeDiff,
  MAX_TABLE_DIFF_COST,
  MAX_CELL_DIFF_COST,
} from "./diffCost";

/** 表を行×セルのテキスト行列に正規化したもの（th/td のテキストのみ）。 */
export type TableMatrix = readonly (readonly string[])[];

/** 行の対応付け結果（prev/next を統合した出現順）。 */
export interface RowAlignment {
  readonly kind: "match" | "insert" | "delete";
  readonly prevRow: number | null; // delete/match で有効
  readonly nextRow: number | null; // insert/match で有効
}

/** 変更セル 1 つ分の語差分（本文と同じ DiffOp[]）。 */
export interface CellDiff {
  readonly nextRow: number; // next 表上の行
  readonly col: number;
  readonly ops: readonly DiffOp[]; // diff(prevCell, nextCell)
}

/** 表ペアの差分計画。degraded=true なら呼び出し側はテキスト退化（L2）。 */
export interface TableDiffResult {
  readonly degraded: boolean;
  readonly rows: readonly RowAlignment[];
  readonly cells: readonly CellDiff[]; // 変更のあったセルのみ
  readonly insertedRows: readonly number[]; // next 上の追加行（全セル緑）
  readonly deletedRows: readonly number[]; // prev 上の削除行（幻 row を赤で挿入）
}

/** 行の列数の最大値（不揃いな行に対する列数判定）。 */
function maxCols(matrix: TableMatrix): number {
  return matrix.reduce((acc, row) => Math.max(acc, row.length), 0);
}

/** 行キー = セルを区切り文字で連結（行 LCS の比較キー）。 */
function rowKey(row: readonly string[]): string {
  return row.join("");
}

/** L2（テキスト退化）の結果。呼び出し側はグローバル語差分へ委譲する。 */
function degradedResult(): TableDiffResult {
  return {
    degraded: true,
    rows: [],
    cells: [],
    insertedRows: [],
    deletedRows: [],
  };
}

/** 1 セルの語差分操作を作る。巨大セルは全置換（語差分せず）へ縮退する。 */
function cellOps(prevCell: string, nextCell: string): readonly DiffOp[] {
  const cost = estimateDiffCost(countTokens(prevCell), countTokens(nextCell));
  if (shouldDegradeDiff(cost, MAX_CELL_DIFF_COST)) {
    // 旧セル全体=赤・新セル全体=緑（語差分しない）。
    const ops: DiffOp[] = [];
    if (prevCell !== "") ops.push({ kind: "delete", text: prevCell });
    if (nextCell !== "") ops.push({ kind: "insert", text: nextCell });
    return ops;
  }
  return diff(prevCell, nextCell);
}

/** 行ペアを列ごとに比較し、変更セルだけ CellDiff を積む。表コストも加算する。 */
function diffRowCells(
  prevRow: readonly string[],
  nextRow: readonly string[],
  nextRowIndex: number,
  cols: number,
  cells: CellDiff[],
): number {
  let cost = 0;
  for (let col = 0; col < cols; col++) {
    const prevCell = prevRow[col] ?? "";
    const nextCell = nextRow[col] ?? "";
    cost += estimateDiffCost(countTokens(prevCell), countTokens(nextCell));
    if (prevCell === nextCell) {
      continue;
    }
    cells.push({
      nextRow: nextRowIndex,
      col,
      ops: cellOps(prevCell, nextCell),
    });
  }
  return cost;
}

/** 行キー列の LCS を求め、対応ステップを行対応（RowAlignment）へ写像する。 */
function alignRows(
  prevKeys: readonly string[],
  nextKeys: readonly string[],
): RowAlignment[] {
  return lcsAlign(prevKeys, nextKeys).map((step): RowAlignment => {
    switch (step.kind) {
      case "equal":
        return { kind: "match", prevRow: step.a, nextRow: step.b };
      case "delete":
        return { kind: "delete", prevRow: step.a, nextRow: null };
      case "insert":
        return { kind: "insert", prevRow: null, nextRow: step.b };
    }
  });
}

/**
 * 2 つの表行列の差分計画を求める。
 * @returns 列数相違なら degraded=true（L2）。それ以外はセル/行差分の計画。
 */
export function diffTable(
  prev: TableMatrix,
  next: TableMatrix,
): TableDiffResult {
  const prevCols = maxCols(prev);
  const nextCols = maxCols(next);

  // L2: 列数相違（構造変化）はセル対応を諦め、テキスト退化へ委譲する。
  if (prevCols !== nextCols) {
    return degradedResult();
  }
  const cols = nextCols;

  const cells: CellDiff[] = [];
  let tableCost = 0;

  // L0 高速路: 行数一致なら index 対応で per-cell 差分（最頻ケース＝セル編集のみ）。
  if (prev.length === next.length) {
    for (let r = 0; r < next.length; r++) {
      tableCost += diffRowCells(prev[r] ?? [], next[r] ?? [], r, cols, cells);
      if (shouldDegradeDiff(tableCost, MAX_TABLE_DIFF_COST)) {
        return degradedResult();
      }
    }
    const rows: RowAlignment[] = next.map((_, r) => ({
      kind: "match",
      prevRow: r,
      nextRow: r,
    }));
    return { degraded: false, rows, cells, insertedRows: [], deletedRows: [] };
  }

  // L1: 行数相違 → 行 LCS。
  const rows = alignRows(prev.map(rowKey), next.map(rowKey));
  const insertedRows: number[] = [];
  const deletedRows: number[] = [];
  for (const row of rows) {
    if (row.kind === "match" && row.prevRow !== null && row.nextRow !== null) {
      tableCost += diffRowCells(
        prev[row.prevRow] ?? [],
        next[row.nextRow] ?? [],
        row.nextRow,
        cols,
        cells,
      );
    } else if (row.kind === "insert" && row.nextRow !== null) {
      insertedRows.push(row.nextRow);
    } else if (row.kind === "delete" && row.prevRow !== null) {
      deletedRows.push(row.prevRow);
    }
    if (shouldDegradeDiff(tableCost, MAX_TABLE_DIFF_COST)) {
      return degradedResult();
    }
  }
  return { degraded: false, rows, cells, insertedRows, deletedRows };
}
