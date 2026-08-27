// ドラッグ&ドロップのパス絞り込み。
//
// ドロップされたパス一覧から Markdown ファイル（.md / .markdown）のみを抽出する
// 純関数。Rust 側 `extract_md_paths`（CLI 起動）のフロント版に相当する。
// 大文字小文字を無視し、重複は入力順を保って除去する。

import { isMarkdownPath, normalizePathKey } from "./markdownPath";

/**
 * ドロップされたパスから Markdown のみを抽出する。
 * 入力順を保持しつつ重複を除去する。重複判定は正規化キー（大文字小文字・区切り
 * 文字の差を吸収）で行い、同じファイルを二重に開かないようにする。
 */
export function filterMarkdownPaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    const key = normalizePathKey(path);
    if (!isMarkdownPath(path) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(path);
  }
  return result;
}
