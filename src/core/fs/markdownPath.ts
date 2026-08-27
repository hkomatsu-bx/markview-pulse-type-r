// Markdown ファイルの同定に関する純粋ロジック。
//
// 「どの拡張子を Markdown とみなすか」「同じファイルを指すパスか」の 2 つは、
// ダイアログのフィルタ・ドロップの絞り込み・PDF 名の導出・タブの重複判定と
// 複数箇所から参照される。定義が分散すると経路ごとに挙動がずれるため、
// ここを唯一の源にする（Rust 側 commands/cli.rs は言語境界のため別実装）。

/** Markdown とみなす拡張子（ドットなし・小文字）。ダイアログのフィルタにも使う。 */
export const MARKDOWN_EXTENSIONS: readonly string[] = ["md", "markdown"];

/** 末尾の Markdown 拡張子にマッチする正規表現（大文字小文字を無視）。 */
export const MARKDOWN_EXTENSION_RE = new RegExp(
  `\\.(?:${MARKDOWN_EXTENSIONS.join("|")})$`,
  "i",
);

/** Markdown 拡張子かどうかを判定する（大文字小文字を無視）。 */
export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSION_RE.test(path);
}

/**
 * 同一ファイル判定用にパスを正規化する。
 *
 * Windows はパスの大文字小文字を区別せず、区切り文字も `\` と `/` が混在する。
 * 生の文字列比較のままだと、同じファイルを `C:\DOCS\a.md` と `C:/Docs/a.md` で
 * 開いたときに別タブとして二重に開き、監視も二重に走ってしまう。
 *
 * 注: 8.3 短縮名やシンボリックリンクまでは解決しない（実体解決は I/O を伴うため
 * 純粋な層では扱えない）。実務上ほぼすべての重複はこの正規化で吸収できる。
 */
export function normalizePathKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** 2 つのパスが同一ファイルを指すとみなせるか。 */
export function isSamePath(a: string, b: string): boolean {
  return normalizePathKey(a) === normalizePathKey(b);
}
