// 印刷 / PDF 書き出し補助。
//
// DOM・Tauri・I/O に依存しない純関数のみを置く（単体テスト可能にするため）。
// 副作用（document.title 設定・保存ダイアログ・window.print）は呼び出し側（main.ts）の責務。
// 印刷ヘッダー / フッターは CSS では作れない（Chromium は @page のマージンボックスを
// 未実装）ため、PDF では WebView2 の印刷設定側（commands/print.rs）で指定する。

import { MARKDOWN_EXTENSION_RE } from "./fs/markdownPath";

/**
 * 用紙余白（ミリメートル）。値の源はここ 1 か所。
 *
 * 画面の `@page` は main.ts がこの値から組み立てて注入し、PDF 書き出しは同じ値を
 * IPC で Rust へ渡す（`@page` は CSS 変数を受け付けないため注入で単一化する）。
 * 数値を 2 か所に書くと単位換算を挟むぶん乖離しやすく、しかもテストで検出できない。
 */
export const PAGE_MARGIN_MM: {
  readonly vertical: number;
  readonly horizontal: number;
} = {
  vertical: 16,
  horizontal: 14,
};

/** `PAGE_MARGIN_MM` を `@page` ルールの文字列へ変換する。 */
export function buildPageMarginCss(
  margins: typeof PAGE_MARGIN_MM = PAGE_MARGIN_MM,
): string {
  return `@page { margin: ${String(margins.vertical)}mm ${String(margins.horizontal)}mm; }`;
}

/**
 * PDF の保存名・Title プロパティに使う文字列を、MD ファイル名から導出する。
 * 末尾の `.md` / `.markdown`（大文字小文字無視）のみ除去し、それ以外はそのまま返す。
 * 例: `README.md` → `README`、`notes.markdown` → `notes`、`a.md.md` → `a.md`。
 */
export function pdfTitleFromFileName(fileName: string): string {
  return fileName.replace(MARKDOWN_EXTENSION_RE, "");
}

/**
 * PDF 保存ダイアログの既定ファイル名を MD ファイル名から導出する。
 * 例: `README.md` → `README.pdf`。拡張子の最終補完は Rust 側でも行う
 * （利用者がダイアログで拡張子を消して確定できるため）。
 */
export function pdfFileNameFromFileName(fileName: string): string {
  return `${pdfTitleFromFileName(fileName)}.pdf`;
}
