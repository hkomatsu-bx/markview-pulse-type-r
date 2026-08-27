// 原文（source）を論理行へ分割する純ロジックと、その行数の数え方。
// 行番号の描画自体は ui/preview.ts ＋ CSS counter が担う。
//
// 「論理行」の定義はここを唯一の源にする。ステータスバーの行数（documentStats）と
// 原文ビューの行番号が別々の数え方をしていると、末尾が改行のファイルで表示が
// 常に 1 ずれる（同じ画面で矛盾する）ため、両者が同じ定義を参照する。
//
// 仕様:
// - CRLF は LF へ正規化してから分割する（Windows 由来の原文を素直に扱う）。
// - 末尾改行は行終端子とみなし、行を増やさない（`wc -l` と同じ数え方）。
//   これにより「行数」と最終行の行番号が一致する。
// - 文中の空行は 1 行として保持する（番号を振る対象）。
// - 空文字列は 0 行（[]）。

export function splitSourceLines(source: string): readonly string[] {
  if (source === "") {
    return [];
  }
  const normalized = source.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  // 末尾改行（行終端子）が生む最後の空要素のみ落とす。
  // 文中・末尾の「実在する空行」は保持する（1 行だけ除く）。
  // 不変性のため pop による破壊変更ではなく slice で新配列を返す。
  return lines.length > 0 && lines[lines.length - 1] === ""
    ? lines.slice(0, -1)
    : lines;
}

/**
 * 論理行数を数える（[`splitSourceLines`] と同じ定義。配列は作らない）。
 * 末尾の改行は行を増やさないため、返る値は最終行の行番号と一致する。
 */
export function countLines(source: string): number {
  if (source === "") {
    return 0;
  }
  let count = 1;
  for (
    let i = source.indexOf("\n");
    i !== -1;
    i = source.indexOf("\n", i + 1)
  ) {
    count++;
  }
  // 末尾が改行なら、その改行が作る空の最終行は数えない。
  return source.endsWith("\n") ? count - 1 : count;
}
