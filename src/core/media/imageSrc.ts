// 画像 src の分類（純粋・DOM/IPC 非依存）。
//
// プレビューの <img> src を「ローカル画像（data URI 埋め込み対象）」か
// 「非ローカル（remote / data / 既に解決済み。素通し）」かに分類する。
// WebView は相対 URL を配信元基準で解決してしまい、ローカル画像を表示できない
// ため、ローカル判定されたものだけ Rust で読んで data URI へ差し替える。

/** 先頭が URL スキーム（`http:` `data:` `file:` 等）かを判定する。 */
const HAS_URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** Windows のドライブレター始まり（`C:\` / `C:/`）＝ローカル絶対パス。 */
const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:[\\/]/;

/** UNC / プロトコル相対（先頭が 2 つのパス区切り。`\\host` `//host` や混在）。 */
const NETWORK_OR_UNC = /^[\\/]{2}/;

/**
 * src がローカル画像（data URI 埋め込み対象）かを判定する。
 *
 * - `http:` / `https:` / `data:` / `blob:` などスキーム付き、および
 *   UNC・プロトコル相対（`\\host` / `//host` / 混在）は「非ローカル」= false（素通し）。
 *   UNC を非ローカルにするのは、Rust 側で canonicalize が SMB 接続＋NTLM 認証を
 *   誘発する強制認証（資格情報漏洩）を防ぐための多層防御（権威的判定は Rust 側）。
 * - Windows ドライブパス（`C:\...`）は先頭がスキームに見えるが、ローカル = true。
 * - それ以外（相対パス・POSIX 絶対パス）はローカル = true。
 * - 空・空白のみは false。
 */
export function isLocalImageSrc(src: string): boolean {
  const trimmed = src.trim();
  if (trimmed === "") {
    return false;
  }
  if (NETWORK_OR_UNC.test(trimmed)) {
    return false;
  }
  if (WINDOWS_DRIVE_PATH.test(trimmed)) {
    return true;
  }
  if (HAS_URI_SCHEME.test(trimmed)) {
    return false;
  }
  return true;
}
