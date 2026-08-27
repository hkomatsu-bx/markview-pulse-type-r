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

// 直前の描画の入力と結果。render() はタブ切替・差分トグル・テーマ切替・別タブの
// close など多くの操作で走るが、入力が同じなら生成される DOM も同じ。
// 一度でも外部編集が入ったタブは previousSource≠source が次の編集まで続くため、
// メモ化しないと毎回 markdown を 2 回描画し直し、全文 LCS（最大 20M セルの
// Int32Array 確保）まで再計算することになる。
interface RenderMemo {
  readonly key: string;
  readonly html: string;
  readonly result: PreviewResult;
}
let memo: RenderMemo | null = null;

/** メモ化キー。描画結果を一意に決める入力をすべて含める。 */
function memoKey(tab: Tab, diffHighlight: boolean): string {
  // 長さを前置し、区切り文字が本文に現れても衝突しないようにする。
  return [
    tab.viewMode,
    String(diffHighlight),
    String(tab.previousSource.length),
    String(tab.source.length),
    tab.previousSource,
    tab.source,
  ].join(" ");
}

// 直近に描画した Markdown ソースと HTML。RenderMemo は「同じ入力の再描画」を
// 省くだけで、ソースが変わると効かない。差分表示では 1 回の描画で prev/next の
// 2 本を通すが、外部編集が続くと前回の next が今回の prev になるため、控えておけば
// 2 本のうち 1 本を使い回せる（renderMarkdown は 50KB で 100ms 級と重い）。
// 2 件保持するのは、1 件だと同一描画内の 2 本目が 1 本目を追い出して
// 次回そのどちらも当たらなくなるため。
const MARKDOWN_CACHE_SIZE = 2;

interface MarkdownCacheEntry {
  readonly source: string;
  readonly html: string;
}
let markdownCache: readonly MarkdownCacheEntry[] = [];

/** 同一ソースなら前回の描画結果を返す（renderMarkdown は純粋関数のため安全）。 */
function renderMarkdownCached(source: string): string {
  const hit = markdownCache.find((entry) => entry.source === source);
  if (hit) {
    return hit.html;
  }
  const html = renderMarkdown(source);
  markdownCache = [{ source, html }, ...markdownCache].slice(
    0,
    MARKDOWN_CACHE_SIZE,
  );
  return html;
}

/** テスト用にメモを破棄する（モジュール状態を跨いだ汚染を防ぐ）。 */
export function clearPreviewMemo(): void {
  memo = null;
  markdownCache = [];
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
  // 同一入力なら前回生成した HTML をそのまま流し込み、markdown 描画と差分計算を省く。
  // 原文モードは <pre> の組み立てだけで安価なため対象外。
  const key = tab.viewMode === "source" ? null : memoKey(tab, diffHighlight);
  if (key !== null && memo?.key === key) {
    container.innerHTML = memo.html;
    return memo.result;
  }

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
  let result: PreviewResult;
  if (diffHighlight && tab.previousSource !== tab.source) {
    result = {
      diffDegraded: renderDiff(
        container,
        renderMarkdownCached(tab.previousSource),
        renderMarkdownCached(tab.source),
      ).degraded,
    };
  } else {
    container.innerHTML = renderMarkdownCached(tab.source);
    result = { diffDegraded: false };
  }

  // 差分は DOM を直接書き換えるため、確定後の innerHTML を控える。
  if (key !== null) {
    memo = { key, html: container.innerHTML, result };
  }
  return result;
}
