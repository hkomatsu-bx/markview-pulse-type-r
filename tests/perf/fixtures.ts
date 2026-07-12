// 性能ベンチ用の代表 Markdown 生成（決定論的計測）。
//
// 見出し/段落/強調/斜体/CJK 括弧隣接強調/リスト/コード/引用を混在させ、
// 実利用に近い描画・差分負荷を作る。サイズはバイト数で制御する。

const UNIT = `## 見出し セクション

これは **強調** と *斜体* を含む段落です。CJK 括弧の隣接強調 「**重要**」 も含む。
日本語と English mixed text for realistic rendering load.

- リスト項目 alpha
- リスト項目 beta
- リスト項目 gamma

\`\`\`ts
const x: number = 42;
function f(a: number): number {
  return a * 2;
}
\`\`\`

> 引用ブロック。段落の区切りを作る。

`;

/** 指定バイト数以上になるまで UNIT を繰り返した Markdown を返す。 */
export function markdownOfSize(targetBytes: number): string {
  let out = "";
  while (Buffer.byteLength(out, "utf8") < targetBytes) {
    out += UNIT;
  }
  return out;
}

/** 小さな現実的編集を加えた変種を返す（差分計測用。多くのトークンは共通）。 */
export function editedVariant(source: string): string {
  const changed = source.replace("**強調**", "**強調(改)**");
  return `${changed}\n\n追記された最終段落。変更反映の差分を作る。\n`;
}

/** 描画計測の代表サイズ（markdown-it はおおむね線形）。 */
export const RENDER_SIZES = {
  small: 1024,
  medium: 50 * 1024,
  large: 500 * 1024,
} as const;

/** 差分計測の代表サイズ。diffEngine は O(n*m) のため「一般的文書」の範囲に絞る。 */
export const DIFF_SIZES = [1024, 4 * 1024, 16 * 1024] as const;

/** 決定論的な表行列を生成する（計測用）。先頭はヘッダ行。 */
export function tableOfSize(
  rows: number,
  cols: number,
): readonly (readonly string[])[] {
  const header = Array.from({ length: cols }, (_, c) => `列${String(c)}`);
  const body = Array.from({ length: rows }, (_, r) =>
    Array.from(
      { length: cols },
      (_, c) => `セル R${String(r)}C${String(c)} 値`,
    ),
  );
  return [header, ...body];
}

/** 一部セルだけ編集した表の変種を返す（多くのセルは共通＝L0 セル編集）。 */
export function editedTable(
  table: readonly (readonly string[])[],
): readonly (readonly string[])[] {
  return table.map((row, r) =>
    r % 5 === 1 ? row.map((cell, c) => (c === 1 ? `${cell}(改)` : cell)) : row,
  );
}

/** 表差分計測の代表サイズ（行数 × 列数）。 */
export const TABLE_SIZES = [
  { rows: 20, cols: 4 },
  { rows: 100, cols: 6 },
  { rows: 500, cols: 8 },
] as const;
