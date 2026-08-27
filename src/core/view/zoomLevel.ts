// 本文（プレビュー/原文）のズーム倍率プリセットと増減ロジック。
// 値（パーセント）は CSS 変数 `--content-zoom`（無次元倍率）へ反映される。
// UI 全体ではなく本文のみを拡大する設計（ツールバー等は等倍を維持）。

import { cyclePreset, stepPreset } from "./preset";

export type ZoomPercent = number;

/** ズーム段階（パーセント）。昇順。 */
export const ZOOM_LEVELS: readonly ZoomPercent[] = [
  50, 75, 100, 125, 150, 175, 200,
];

/** 既定ズーム（等倍）。ZOOM_LEVELS の要素であること。 */
export const DEFAULT_ZOOM_PERCENT: ZoomPercent = 100;

/** 一段拡大する。最大段で頭打ち。未知値は既定へ寄せる（防御的）。 */
export function zoomIn(current: ZoomPercent): ZoomPercent {
  return stepPreset(ZOOM_LEVELS, current, 1, DEFAULT_ZOOM_PERCENT);
}

/** 一段縮小する。最小段で頭打ち。未知値は既定へ寄せる（防御的）。 */
export function zoomOut(current: ZoomPercent): ZoomPercent {
  return stepPreset(ZOOM_LEVELS, current, -1, DEFAULT_ZOOM_PERCENT);
}

/** 次段へ順送りし、末尾は先頭へ折り返す（ツールバーボタン用）。 */
export function cycleZoom(current: ZoomPercent): ZoomPercent {
  return cyclePreset(ZOOM_LEVELS, current, DEFAULT_ZOOM_PERCENT);
}

/** 既定（等倍）へ戻す。 */
export function resetZoom(): ZoomPercent {
  return DEFAULT_ZOOM_PERCENT;
}

/** パーセントを CSS 用の無次元倍率へ変換する（150 → 1.5）。 */
export function zoomToScale(percent: ZoomPercent): number {
  return percent / 100;
}

/** 表示用のパーセント文字列（125 → "125%"）。 */
export function zoomPercentLabel(percent: ZoomPercent): string {
  return `${String(percent)}%`;
}
