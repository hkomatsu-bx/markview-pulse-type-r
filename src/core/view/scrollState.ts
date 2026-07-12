// タブごとのスクロール位置を不変マップで保持する純ロジックと、
// 外部更新での再描画時に位置を近似復元するための比率計算。
// 実際の scrollTop の読み書きは main.ts（副作用）が担う。

import type { TabId } from "../../types";

/** タブ ID → スクロール位置（scrollTop, px）の不変マップ。 */
export type ScrollPositions = ReadonlyMap<TabId, number>;

export function createScrollPositions(): ScrollPositions {
  return new Map<TabId, number>();
}

export function setScrollPosition(
  positions: ScrollPositions,
  id: TabId,
  top: number,
): ScrollPositions {
  const next = new Map(positions);
  next.set(id, top);
  return next;
}

/** 未記録なら 0 を返す。 */
export function getScrollPosition(
  positions: ScrollPositions,
  id: TabId,
): number {
  return positions.get(id) ?? 0;
}

export function removeScrollPosition(
  positions: ScrollPositions,
  id: TabId,
): ScrollPositions {
  if (!positions.has(id)) {
    return positions;
  }
  const next = new Map(positions);
  next.delete(id);
  return next;
}

/**
 * 再描画前後でスクロール位置を比率保存により近似復元する。
 *
 * 外部更新で本文の高さが変わるため、絶対位置ではなく
 * 「前回のスクロール比率」を新しい高さに適用する。
 * 高さが 0 以下（未レイアウト等）の場合は 0 を返す。
 */
export function preserveScrollRatio(
  prevTop: number,
  prevScrollHeight: number,
  nextScrollHeight: number,
): number {
  if (prevScrollHeight <= 0 || nextScrollHeight <= 0) {
    return 0;
  }
  const ratio = prevTop / prevScrollHeight;
  return ratio * nextScrollHeight;
}
