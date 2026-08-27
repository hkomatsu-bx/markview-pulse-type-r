// 差分の計算量ガード。
//
// 差分エンジンは語単位 LCS で時間・メモリともに O(n×m)（n,m=トークン数）。
// DP マトリクス（n×m セル）の確保が律速のため、コストは「トークン数の積」で概算する。
// 閾値を超えたら縮退（ハイライト省略・テキスト退化・全置換）する判定を提供する。
// 純粋関数のみ。DOM/Tauri 非依存。

// 上限値は「DP マトリクスのセル数（≒トークン数の積）」。DP は Int32Array（4B/セル）
// で確保するため、20M セル ≒ 80MB の一時確保に相当する（計算後に解放）。

/** 全文インライン差分（prev↔current 全文）の上限。約 4,472² 相当（≒80MB）。 */
export const MAX_INLINE_DIFF_COST = 20_000_000;

/** 1 表あたりの集計コスト上限（Σセル積）。複数表を抑制するため全文より小。 */
export const MAX_TABLE_DIFF_COST = 8_000_000;

/**
 * 行 LCS（行数の積）の上限。セル内容とは独立に、DP 行列の確保そのものを抑える。
 * 空セルばかりの巨大表はトークン数によるコスト評価が効かないため、行数で見る。
 * 4M セル ≒ 16MB（約 2,000 行 × 2,000 行）。
 */
export const MAX_TABLE_ROW_COST = 4_000_000;

/** 1 セルあたりの語差分上限。約 632² 相当を超える巨大セルのみ縮退。 */
export const MAX_CELL_DIFF_COST = 400_000;

/** トークン数の積で差分コストを概算する（O(n*m) の n*m）。 */
export function estimateDiffCost(
  prevTokenCount: number,
  nextTokenCount: number,
): number {
  return prevTokenCount * nextTokenCount;
}

/** 概算コストが閾値を超えるなら縮退すべきと判定する。 */
export function shouldDegradeDiff(cost: number, max: number): boolean {
  return cost > max;
}
