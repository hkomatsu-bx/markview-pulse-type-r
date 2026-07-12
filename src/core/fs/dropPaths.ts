// ドラッグ&ドロップのパス絞り込み。
//
// ドロップされたパス一覧から Markdown ファイル（.md / .markdown）のみを抽出する
// 純関数。Rust 側 `extract_md_paths`（CLI 起動）のフロント版に相当する。
// 大文字小文字を無視し、重複は入力順を保って除去する。

const MARKDOWN_EXTENSIONS: readonly string[] = [".md", ".markdown"];

/** Markdown 拡張子かどうかを判定する（大文字小文字無視）。 */
function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * ドロップされたパスから Markdown のみを抽出する。
 * 入力順を保持しつつ重複を除去する。
 */
export function filterMarkdownPaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (!isMarkdownPath(path) || seen.has(path)) {
      continue;
    }
    seen.add(path);
    result.push(path);
  }
  return result;
}
