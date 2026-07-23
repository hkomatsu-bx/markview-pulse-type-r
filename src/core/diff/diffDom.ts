// 差分の DOM 適用。
//
// 方針：差分は「描画後 DOM のテキストノード列を連結したテキスト」を基準に取る。
// 現在（next）を描画した DOM の書式（markdown-it の出力構造）を保ったまま、
//   insert 区間 → span.diff-added（緑）
//   delete 区間 → span.diff-removed（赤＋取消線）を注入
// する。equal は無加工。
//
// 表（<table>）は出現順 index で prev↔next を対応付け、セル単位で語差分を重ねる。
// 行追加=緑・行削除=幻行（赤）。処理済みの表はグローバル語差分の対象から除外し、
// 二重適用を防ぐ。列数相違（構造変化）や巨大表は L2（テキスト退化）でグローバルへ委譲する。
//
// 全文の差分コスト（トークン積）が閾値超過なら、ハイライトを一切行わず素描画し、
// degraded=true を返す（呼び出し側が利用者へ通知する＝無音失敗禁止）。

import type { DiffOp } from "../../types";
import { diff, countTokens } from "./diffEngine";
import { diffTable, type TableMatrix } from "./tableDiff";
import {
  estimateDiffCost,
  shouldDegradeDiff,
  MAX_INLINE_DIFF_COST,
} from "./diffCost";

const ADDED_CLASS = "diff-added";
const REMOVED_CLASS = "diff-removed";
const REMOVED_ROW_CLASS = "diff-removed-row";

/** span.diff-added / diff-removed を生成する。 */
function makeSpan(
  doc: Document,
  className: string,
  text: string,
): HTMLSpanElement {
  const span = doc.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

/**
 * DOM ツリーを文書順にたどり、テキストノードを集める（読み取りのみ）。
 * excluded に含まれる要素のサブツリーは丸ごとスキップする（処理済みの表など）。
 */
function collectTextNodes(root: Node, excluded?: ReadonlySet<Element>): Text[] {
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return excluded?.has(node as Element)
            ? NodeFilter.FILTER_REJECT // サブツリーごと除外
            : NodeFilter.FILTER_SKIP; // 要素自身は返さず子のみ辿る
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    nodes.push(n as Text);
  }
  return nodes;
}

/** テキストノード列を連結した全文を返す。差分エンジンの入力に使う。 */
export function extractText(
  root: Node,
  excluded?: ReadonlySet<Element>,
): string {
  return collectTextNodes(root, excluded)
    .map((n) => n.data)
    .join("");
}

interface InsertRange {
  readonly start: number;
  readonly end: number;
}

interface DeletePoint {
  readonly pos: number;
  readonly text: string;
}

/** 操作列を global オフセット基準の挿入区間と削除点へ変換する。 */
function indexOps(ops: readonly DiffOp[]): {
  inserts: InsertRange[];
  deletes: DeletePoint[];
  totalLen: number;
} {
  const inserts: InsertRange[] = [];
  const deletes: DeletePoint[] = [];
  let cursor = 0; // next 全文上の位置
  for (const op of ops) {
    switch (op.kind) {
      case "equal":
        cursor += op.text.length;
        break;
      case "insert":
        inserts.push({ start: cursor, end: cursor + op.text.length });
        cursor += op.text.length;
        break;
      case "delete":
        // delete は next 上では幅 0。出現位置に注釈を差し込む。
        deletes.push({ pos: cursor, text: op.text });
        break;
      default: {
        // 将来 DiffOpKind が増えたらコンパイルエラーで検出する。
        const exhaustive: never = op.kind;
        throw new Error(`未知の DiffOpKind: ${String(exhaustive)}`);
      }
    }
  }
  return { inserts, deletes, totalLen: cursor };
}

/**
 * 現在の描画 DOM（next を描画したもの）へ操作列を適用する（破壊的更新）。
 * 既存の要素構造は保持し、テキストノードのみを分割・span 化する。
 * excluded のサブツリー（処理済みの表）は走査・オフセット算出の双方から除外する。
 */
function applyDiff(
  root: HTMLElement,
  ops: readonly DiffOp[],
  excluded?: ReadonlySet<Element>,
): void {
  const doc = root.ownerDocument;
  const { inserts, deletes, totalLen } = indexOps(ops);

  const isInsideInsert = (pos: number): boolean =>
    inserts.some((r) => pos >= r.start && pos < r.end);

  let nodeStart = 0;
  for (const node of collectTextNodes(root, excluded)) {
    const data = node.data;
    const nodeEnd = nodeStart + data.length;

    // この区間 [nodeStart, nodeEnd) に掛かる削除点（終端 nodeEnd は次ノード or 末尾扱い）。
    const localDeletes = deletes.filter(
      (d) => d.pos >= nodeStart && d.pos < nodeEnd,
    );
    const hasInsertOverlap = inserts.some(
      (r) => r.start < nodeEnd && r.end > nodeStart,
    );
    if (localDeletes.length === 0 && !hasInsertOverlap) {
      nodeStart = nodeEnd; // 触れない（参照を維持し再描画コストも抑える）。
      continue;
    }

    // kind が変わる境界（挿入区間の端）と削除点で区切る。
    const bounds = new Set<number>([nodeStart, nodeEnd]);
    for (const r of inserts) {
      if (r.start > nodeStart && r.start < nodeEnd) bounds.add(r.start);
      if (r.end > nodeStart && r.end < nodeEnd) bounds.add(r.end);
    }
    for (const d of localDeletes) bounds.add(d.pos);
    const sorted = [...bounds].sort((a, b) => a - b);

    const children: Node[] = [];
    for (let k = 0; k < sorted.length; k++) {
      const p = sorted[k];
      if (p === undefined) continue;
      for (const d of localDeletes) {
        if (d.pos === p) children.push(makeSpan(doc, REMOVED_CLASS, d.text));
      }
      if (p >= nodeEnd) break;
      const next = sorted[k + 1];
      if (next === undefined) continue;
      const segText = data.slice(p - nodeStart, next - nodeStart);
      if (segText.length === 0) continue;
      children.push(
        isInsideInsert(p)
          ? makeSpan(doc, ADDED_CLASS, segText)
          : doc.createTextNode(segText),
      );
    }
    node.replaceWith(...children);
    nodeStart = nodeEnd;
  }

  // 現在テキストの終端に位置する削除は、どのノードにも属さないため末尾へ付与する。
  for (const d of deletes) {
    if (d.pos === totalLen)
      root.appendChild(makeSpan(doc, REMOVED_CLASS, d.text));
  }
}

/** 表 DOM を行×セルのテキスト行列へ正規化する（th/td の textContent）。 */
function tableToMatrix(table: HTMLTableElement): TableMatrix {
  return Array.from(table.rows).map((row) =>
    Array.from(row.cells).map((cell) => cell.textContent ?? ""),
  );
}

/** 削除行を表す幻の <tr>（赤・取消線）を生成する。表示専用のため aria-hidden を付与。 */
function buildPhantomRow(
  doc: Document,
  prevRow: readonly string[],
  colCount: number,
): HTMLTableRowElement {
  const tr = doc.createElement("tr");
  tr.className = REMOVED_ROW_CLASS;
  tr.setAttribute("aria-hidden", "true");
  for (let c = 0; c < colCount; c++) {
    const td = doc.createElement("td");
    td.appendChild(makeSpan(doc, REMOVED_CLASS, prevRow[c] ?? ""));
    tr.appendChild(td);
  }
  return tr;
}

/**
 * 表ペアにセル単位差分を適用する。
 * @returns true=処理済み（グローバル掃引から除外）/ false=L2 退化（グローバルへ委譲）。
 */
function applyTableDiff(
  prevTable: HTMLTableElement,
  nextTable: HTMLTableElement,
): boolean {
  const prevM = tableToMatrix(prevTable);
  const nextM = tableToMatrix(nextTable);
  const result = diffTable(prevM, nextM);
  if (result.degraded) {
    return false; // 列数相違・巨大表 → グローバル語差分へ委譲
  }

  const doc = nextTable.ownerDocument;
  const nextRows = Array.from(nextTable.rows);
  const colCount = nextM.reduce((acc, row) => Math.max(acc, row.length), 0);

  // 1. 変更セルへ語差分を重ねる（セル内スコープで applyDiff を再利用）。
  for (const cell of result.cells) {
    const cellEl = nextRows[cell.nextRow]?.cells[cell.col];
    if (cellEl instanceof HTMLElement) {
      applyDiff(cellEl, cell.ops);
    }
  }

  // 2. 追加行: 各セル内容を緑で包む。
  for (const r of result.insertedRows) {
    const rowEl = nextRows[r];
    if (!rowEl) continue;
    for (const cellEl of Array.from(rowEl.cells)) {
      cellEl.replaceChildren(
        makeSpan(doc, ADDED_CLASS, cellEl.textContent ?? ""),
      );
    }
  }

  // 3. 削除行: 幻 <tr>（赤）を対応位置へ挿入（要素参照をアンカーにするので順序安全）。
  const fallbackParent =
    nextRows[nextRows.length - 1]?.parentElement ?? nextTable;
  let pending: HTMLTableRowElement[] = [];
  const flushBefore = (anchor: HTMLTableRowElement | null): void => {
    for (const ph of pending) {
      if (anchor?.parentElement) {
        anchor.parentElement.insertBefore(ph, anchor);
      } else {
        fallbackParent.appendChild(ph);
      }
    }
    pending = [];
  };
  for (const al of result.rows) {
    if (al.kind === "delete" && al.prevRow !== null) {
      pending.push(buildPhantomRow(doc, prevM[al.prevRow] ?? [], colCount));
    } else if (al.nextRow !== null) {
      flushBefore(nextRows[al.nextRow] ?? null);
    }
  }
  flushBefore(null); // 末尾の削除行は追記

  return true;
}

/**
 * 前回 HTML と現在 HTML から差分表示を container に構築する。
 * container には next を描画し、prev との語差分を span で重ねる。
 * @returns degraded=true なら全文が大きすぎてハイライトを省略した（呼び出し側で通知）。
 */
export function renderDiff(
  container: HTMLElement,
  prevHtml: string,
  nextHtml: string,
): { readonly degraded: boolean } {
  container.innerHTML = nextHtml;
  const doc = container.ownerDocument;
  const prevRoot = doc.createElement("div");
  prevRoot.innerHTML = prevHtml;

  // 1. 全文コストガード。閾値超過なら素描画のまま degraded を返す。
  const fullPrev = extractText(prevRoot);
  const fullNext = extractText(container);
  const cost = estimateDiffCost(countTokens(fullPrev), countTokens(fullNext));
  if (shouldDegradeDiff(cost, MAX_INLINE_DIFF_COST)) {
    return { degraded: true };
  }

  // 2. 表のセル単位差分。処理済み表をグローバル掃引から除外する。
  //    フロントマター表（.front-matter）は出現順の対応付けを狂わせる（有無で本文表と
  //    ずれる）ため対象外にし、本文の表だけを index で対応付ける。
  const nextTables = Array.from(
    container.querySelectorAll<HTMLTableElement>("table:not(.front-matter)"),
  );
  const prevTables = Array.from(
    prevRoot.querySelectorAll<HTMLTableElement>("table:not(.front-matter)"),
  );
  const excludedNext = new Set<Element>();
  const excludedPrev = new Set<Element>();
  const pairCount = Math.min(nextTables.length, prevTables.length);
  for (let i = 0; i < pairCount; i++) {
    const prevT = prevTables[i];
    const nextT = nextTables[i];
    if (prevT && nextT && applyTableDiff(prevT, nextT)) {
      excludedNext.add(nextT);
      excludedPrev.add(prevT);
    }
  }

  // 2.5 mermaid ブロックは不可分に扱い、差分 span を注入しない。mermaid は要素の
  //     innerHTML を図ソースとして読むため、内部に <span> が残ると解釈が壊れる。
  for (const pre of container.querySelectorAll("pre.mermaid")) {
    excludedNext.add(pre);
  }
  for (const pre of prevRoot.querySelectorAll("pre.mermaid")) {
    excludedPrev.add(pre);
  }

  // 3. グローバル語差分（表処理済み・mermaid を除外して二重適用を防ぐ）。
  const prevText = extractText(prevRoot, excludedPrev);
  const nextText = extractText(container, excludedNext);
  applyDiff(container, diff(prevText, nextText), excludedNext);
  return { degraded: false };
}
