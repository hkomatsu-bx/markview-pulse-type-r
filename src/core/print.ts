// 印刷 / PDF 書き出し補助。
//
// DOM・Tauri・I/O に依存しない純関数のみを置く（単体テスト可能にするため）。
// 副作用（document.title 設定・<style> 注入・window.print）は呼び出し側（main.ts）の責務。

const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/i;
const CONTROL_CHAR_MAX = 0x20; // C0 制御文字の上限（未満を無害化）
const DELETE_CHAR = 0x7f; // DEL

/**
 * PDF の保存名・Title プロパティに使う文字列を、MD ファイル名から導出する。
 * 末尾の `.md` / `.markdown`（大文字小文字無視）のみ除去し、それ以外はそのまま返す。
 * 例: `README.md` → `README`、`notes.markdown` → `notes`、`a.md.md` → `a.md`。
 */
export function pdfTitleFromFileName(fileName: string): string {
  return fileName.replace(MARKDOWN_EXTENSION, "");
}

/**
 * CSS 文字列リテラル内で安全な形へエスケープする。
 * バックスラッシュと二重引用符をエスケープし、制御文字（改行等）は空白へ正規化して
 * `content` 宣言が壊れるのを防ぐ。ファイル名は信頼できない外部由来のため境界で必ず処理する。
 */
function escapeCssString(value: string): string {
  return Array.from(value, (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    if (code < CONTROL_CHAR_MAX || code === DELETE_CHAR) {
      return " ";
    }
    if (ch === "\\") {
      return "\\\\";
    }
    if (ch === '"') {
      return '\\"';
    }
    return ch;
  }).join("");
}

/**
 * 印刷ヘッダー（@page @top-center）へ表示するファイル名を埋め込んだ `@page` ルールを生成する。
 * styles.css 側の静的な体裁（フォント・色・フッターのページ番号）に後勝ちでマージされ、
 * ヘッダー中央の `content` のみを上書きする。
 */
export function buildPrintPageStyle(headerText: string): string {
  return `@page { @top-center { content: "${escapeCssString(headerText)}"; } }`;
}
