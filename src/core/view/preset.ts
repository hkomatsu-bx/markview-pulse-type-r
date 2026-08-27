// プリセット値の順送り・増減に共通する純粋ロジック。
//
// 本文幅（contentWidth）と本文ズーム（zoomLevel）が同じ「一覧から選び、未知値は
// 既定へ寄せる」形を別々に実装していたため、ここへ一本化する。防御の規約を
// 変えるときに 1 か所で済むようにするのが目的。

/**
 * 次の値へ順送りする（末尾は先頭へ折り返す）。
 * 未知値は先頭要素へ寄せる（防御的）。
 */
export function cyclePreset<T>(
  order: readonly T[],
  current: T,
  fallback: T,
): T {
  const index = order.indexOf(current);
  const next = index === -1 ? 0 : (index + 1) % order.length;
  return order[next] ?? fallback;
}

/**
 * 指定段数だけ移動する（両端で頭打ち。折り返さない）。
 * 未知値は既定へ寄せる（防御的）。
 */
export function stepPreset<T>(
  order: readonly T[],
  current: T,
  delta: number,
  fallback: T,
): T {
  const index = order.indexOf(current);
  if (index === -1) {
    return fallback;
  }
  const next = Math.min(Math.max(index + delta, 0), order.length - 1);
  return order[next] ?? fallback;
}
