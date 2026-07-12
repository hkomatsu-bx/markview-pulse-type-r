// ドキュメント統計（ステータスバー）。
//
// アクティブタブのソースから文字数・行数・エンコーディングを算出する純関数。
// DOM / Tauri / I/O に依存しない（単体テスト可能）。

/** ステータスバーに表示するドキュメント統計。 */
export interface DocumentStats {
  /** 文字数（コードポイント単位。CJK・絵文字を 1 文字として計上）。 */
  readonly charCount: number;
  /** 行数（空文字列は 0、非空は改行数 + 1）。 */
  readonly lineCount: number;
  /** 文字エンコーディング表示。Rust が UTF-8 で読込むため固定。 */
  readonly encoding: string;
}

// 書記素クラスタ（人間が知覚する 1 文字）で数えるためのセグメンタ。
// 結合文字・ZWJ 絵文字・サロゲートペアを 1 文字として正しく計上する
// （UTF-16 コードユニット数＝String.length では分割されてしまう）。
const graphemeSegmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });

/**
 * ソース文字列から統計を算出する。
 *
 * 文字数は書記素クラスタ単位（Intl.Segmenter）で計上する。編集機能は無く
 * 算出はファイル開閉/再読込/タブ切替時のみのため、計算量は問題にならない。
 */
export function computeDocumentStats(source: string): DocumentStats {
  if (source.length === 0) {
    return { charCount: 0, lineCount: 0, encoding: "UTF-8" };
  }
  const charCount = [...graphemeSegmenter.segment(source)].length;
  const lineCount = source.split("\n").length;
  return { charCount, lineCount, encoding: "UTF-8" };
}
