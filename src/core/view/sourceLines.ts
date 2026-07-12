// 原文（source）を行番号描画のために論理行へ分割する純ロジック。
// 行番号の描画自体は ui/preview.ts ＋ CSS counter が担う。
//
// 仕様:
// - CRLF は LF へ正規化してから分割する（Windows 由来の原文を素直に扱う）。
// - 末尾改行による空の最終行は行数に数えない（ステータスバーの行数表示と整合）。
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
