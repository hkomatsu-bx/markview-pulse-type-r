// 差分エンジン。
//
// 純関数として実装する。UI・DOM に一切依存しない。
// 入力 2 テストキストをトークン（語または空白）に分割し、LCS で最長共通部分列を
// 求めて equal / insert / delete の操作列を返す。語単位差分のため、変更行が
// 素のテキストに退化せず、本文中のインライン強調（DiffDom）に適している。
//
// 計算量は O(n*m)（n,m はトークン数）。通常規模の Markdown では実用上問題ないが、
// 巨大ファイルでは重くなりうる（v1 は実用範囲を許容）。

import type { DiffOp, DiffOpKind } from "../../types";
import { lcsAlign } from "./lcs";

interface RawOp {
  readonly kind: DiffOpKind;
  readonly text: string;
}

/** テキストを「連続する空白」または「連続する非空白」のトークン列へ分割する。 */
export function tokenize(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

/** トークン数を数える（差分コスト見積もり用・O(n)）。 */
export function countTokens(text: string): number {
  return tokenize(text).length;
}

/** トークン列の LCS を求め、各対応ステップを語単位の生の操作列へ写像する。 */
function lcsDiff(a: readonly string[], b: readonly string[]): RawOp[] {
  // 添字は lcsAlign が境界内で生成するため安全。
  return lcsAlign(a, b).map((step): RawOp => {
    switch (step.kind) {
      case "equal":
        return { kind: "equal", text: a[step.a]! };
      case "delete":
        return { kind: "delete", text: a[step.a]! };
      case "insert":
        return { kind: "insert", text: b[step.b]! };
    }
  });
}

/** 連続する同種の操作を 1 つにまとめる。 */
function mergeOps(raw: readonly RawOp[]): DiffOp[] {
  // 連続同種を結合する。オブジェクトのフィールドは破壊せず、結合時は新オブジェクトで
  // 末尾を置き換える（不変性の保持）。
  const out: DiffOp[] = [];
  for (const op of raw) {
    const last = out[out.length - 1];
    if (last?.kind === op.kind) {
      out[out.length - 1] = { kind: last.kind, text: last.text + op.text };
    } else {
      out.push({ kind: op.kind, text: op.text });
    }
  }
  return out;
}

/**
 * 前回テキストと現在テキストの語単位差分を求める。
 * @returns equal / insert / delete を順に並べた操作列。
 */
export function diff(prevText: string, nextText: string): DiffOp[] {
  if (prevText === nextText) {
    return prevText === "" ? [] : [{ kind: "equal", text: prevText }];
  }
  return mergeOps(lcsDiff(tokenize(prevText), tokenize(nextText)));
}
