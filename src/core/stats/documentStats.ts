// ドキュメント統計（ステータスバー）。
//
// アクティブタブのソースから文字数・行数・エンコーディングを算出する純関数。
// DOM / Tauri / I/O に依存しない（単体テスト可能）。

import { countLines } from "../view/sourceLines";

/** ステータスバーに表示するドキュメント統計。 */
export interface DocumentStats {
  /** 文字数（書記素クラスタ単位。CJK・絵文字を 1 文字として計上）。 */
  readonly charCount: number;
  /**
   * 論理行数。数え方は core/view/sourceLines の定義に従う（末尾改行は行を
   * 増やさない）ため、原文ビューに描かれる最終行の行番号と一致する。
   */
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
  // 走査するだけで数え、セグメント／行の配列を作らない。MB 級の文書では
  // 配列化のぶんだけ一時確保が跳ね上がり、再描画のたびに GC を誘発するため。
  let charCount = 0;
  const segments = graphemeSegmenter.segment(source)[Symbol.iterator]();
  while (!segments.next().done) {
    charCount++;
  }
  return { charCount, lineCount: countLines(source), encoding: "UTF-8" };
}
