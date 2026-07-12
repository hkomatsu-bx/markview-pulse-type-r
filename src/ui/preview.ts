// プレビュー描画。
//
// Tab を受け取り container に描画する。表示モード（viewMode）で分岐する:
// - preview: markdown-it 出力。diffHighlight が ON かつ previousSource≠source なら
//            語差分（diffDom）をインライン重畳する。
// - source : Markdown 原文を <pre> に textContent で表示（XSS 面を増やさない・閲覧専用）
//
// 戻り値の diffDegraded は、全文が大きすぎて差分強調を省略したことを示す。
// 呼び出し側（main.ts）はこれを受けて非モーダル通知を出す（無音失敗禁止）。

import type { Tab } from "../types";
import { renderMarkdown } from "../core/markdown";
import { renderDiff } from "../core/diff/diffDom";
import { splitSourceLines } from "../core/view/sourceLines";

/** プレビュー描画の結果。 */
export interface PreviewResult {
  /** 全文が大きすぎて差分強調を省略した（縮退）。 */
  readonly diffDegraded: boolean;
}

/**
 * アクティブタブの内容を container に描画する。
 * @param diffHighlight プレビュー時に差分強調を重ねるか。
 */
export function renderPreview(
  container: HTMLElement,
  tab: Tab,
  diffHighlight: boolean,
): PreviewResult {
  if (tab.viewMode === "source") {
    // 原文表示は markdown-it を通さず、論理行ごとの span を textContent で
    // 組み立てる（XSS 非増加）。行番号は .src-line::before の CSS counter で
    // 描画し、生成内容はコピー対象外・折返し継続行には番号を出さない。
    const pre = document.createElement("pre");
    pre.className = "source-view";
    for (const line of splitSourceLines(tab.source)) {
      const span = document.createElement("span");
      span.className = "src-line";
      span.textContent = line;
      pre.appendChild(span);
    }
    container.replaceChildren(pre);
    return { diffDegraded: false };
  }

  // プレビュー: 差分強調 ON かつ前回↔現在に差があれば語差分を重畳する。
  if (diffHighlight && tab.previousSource !== tab.source) {
    const result = renderDiff(
      container,
      renderMarkdown(tab.previousSource),
      renderMarkdown(tab.source),
    );
    return { diffDegraded: result.degraded };
  }

  container.innerHTML = renderMarkdown(tab.source);
  return { diffDegraded: false };
}
