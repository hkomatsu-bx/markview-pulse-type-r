// LCS（最長共通部分列）の汎用プリミティブ。
//
// 語単位差分（diffEngine）と表の行対応（tableDiff）が同一の DP 充填＋トレースバックを
// 別実装していたため、ここへ一本化する（DRY・将来の最適化を 1 か所に集約）。
// 純関数。DOM/Tauri に非依存。計算量は O(n*m)。
//
// 出力は出現順の対応ステップ列。何を生成するか（トークン文字列か行インデックスか）は
// 呼び出し側がマップする。

/** LCS の対応ステップ（判別可能ユニオン）。a/b は元配列の添字。 */
export type LcsStep =
  | { readonly kind: "equal"; readonly a: number; readonly b: number }
  | { readonly kind: "delete"; readonly a: number }
  | { readonly kind: "insert"; readonly b: number };

/**
 * 2 列の LCS を求め、出現順の対応ステップ列を返す。
 * @param a 前（旧）側の列。
 * @param b 後（新）側の列。
 * @param eq 要素の等価判定（既定は厳密等価）。
 */
export function lcsAlign<T>(
  a: readonly T[],
  b: readonly T[],
  eq: (x: T, y: T) => boolean = (x, y) => x === y,
): LcsStep[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  // DP マトリクスは 1 次元 Int32Array（(n+1)×(m+1)）で確保する。number[][] より
  // メモリ約半減（4B/セル・行オブジェクト無し）かつ確保が高速で、閾値引き上げ後の
  // 大きめ入力でも安全に扱える。LCS 長は min(n,m) が上限のため Int32 で十分。
  // 索引は i*width + j。0 埋めは Int32Array の既定。
  const dp = new Int32Array((n + 1) * width);

  // 全マスを後ろ向きに埋めるため、以降の dp/a/b への添字アクセスは常に有効。
  // noUncheckedIndexedAccess 下の `!` は、確保済みマトリクス・境界内ループに対する安全な断定。
  for (let i = n - 1; i >= 0; i--) {
    const rowBase = i * width;
    const belowBase = (i + 1) * width;
    const ai = a[i]!;
    for (let j = m - 1; j >= 0; j--) {
      dp[rowBase + j] = eq(ai, b[j]!)
        ? dp[belowBase + j + 1]! + 1
        : Math.max(dp[belowBase + j]!, dp[rowBase + j + 1]!);
    }
  }

  const steps: LcsStep[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i]!, b[j]!)) {
      steps.push({ kind: "equal", a: i, b: j });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j]! >= dp[i * width + (j + 1)]!) {
      // 同点（>=）は削除を優先（既存挙動を保存）。
      steps.push({ kind: "delete", a: i });
      i++;
    } else {
      steps.push({ kind: "insert", b: j });
      j++;
    }
  }
  while (i < n) {
    steps.push({ kind: "delete", a: i++ });
  }
  while (j < m) {
    steps.push({ kind: "insert", b: j++ });
  }
  return steps;
}
