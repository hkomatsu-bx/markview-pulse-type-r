// 本文（プレビュー）の最大表示幅プリセットと順送りロジック。
// 値は CSS 変数 `--content-max-width` へ反映される。

export type ContentWidth = "narrow" | "normal" | "wide" | "full";

/** 既定の表示幅（既存デザインの 860px に対応）。 */
export const DEFAULT_CONTENT_WIDTH: ContentWidth = "normal";

const ORDER: readonly ContentWidth[] = ["narrow", "normal", "wide", "full"];

export function cycleContentWidth(current: ContentWidth): ContentWidth {
  const index = ORDER.indexOf(current);
  // 未知値が来ても既定へ寄せる（防御的）。
  const nextIndex = index === -1 ? 0 : (index + 1) % ORDER.length;
  return ORDER[nextIndex] ?? DEFAULT_CONTENT_WIDTH;
}

/** full は制限なし（`none`）を返す。 */
export function contentWidthToCss(width: ContentWidth): string {
  switch (width) {
    case "narrow":
      return "680px";
    case "normal":
      return "860px";
    case "wide":
      return "1100px";
    case "full":
      return "none";
  }
}

export function contentWidthLabel(width: ContentWidth): string {
  switch (width) {
    case "narrow":
      return "狭";
    case "normal":
      return "標準";
    case "wide":
      return "広";
    case "full":
      return "全幅";
  }
}
