//! ローカル画像の data URI 化コマンド。
//!
//! Markdown が参照するローカル画像を、開いている `.md` の置きディレクトリを
//! 基準に解決し、base64 の `data:` URI として返す。
//!
//! WebView は配信元（`tauri://` / `http://tauri.localhost`）基準でしか相対 URL を
//! 解決できず、CSP も `file:` / `asset:` を許可しないため、ローカル画像はそのままでは
//! 表示できない。CSP の `img-src data:` は許可済みなので、Rust で読んで `data:` に
//! 埋め込む方式を採る。
//!
//! セキュリティ: 読み取りは `.md` の置きディレクトリ配下に限定する（パストラバーサル
//! 対策）。設計の背景と既定方針は `docs/design/local-image-embedding.md` を参照。
//! ロジックは純関数へ分離し、`#[tauri::command]` は薄いラッパにしてテスト可能にする。

use std::fs;
use std::path::{Path, PathBuf};

use base64::{Engine as _, engine::general_purpose::STANDARD};

use crate::error::AppError;

/// 埋め込みを許可する最大サイズ（バイト）。巨大画像による過大なメモリ消費を防ぐ。
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024; // 20 MiB

/// 拡張子から MIME 型を返す純関数。未対応拡張子は `None`（＝埋め込み拒否）。
/// 大文字小文字は無視する。ここに無い形式は許可しない（ホワイトリスト方式）。
fn mime_from_extension(ext: &str) -> Option<&'static str> {
    match ext.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

/// 正規化済みの `target` が `base` 配下（同一を含む）かを判定する純関数。
/// 双方とも `canonicalize` 済みであることを前提とする（シンボリックリンク解決後の
/// 実パスで比較することで、リンクによる配下外への脱出も検出できる）。
fn is_within_base(base: &Path, target: &Path) -> bool {
    target.starts_with(base)
}

/// `src` が UNC / プロトコル相対（先頭が 2 つのパス区切り。`\\host` `//host` や混在）かを
/// 判定する純関数。true のものは実体解決（`canonicalize`）より前に拒否する。
///
/// Windows では UNC パスの `canonicalize` が SMB 接続＋自動 NTLM 認証を誘発し、
/// 未信頼の `.md` から資格情報（NetNTLMv2 ハッシュ）を盗まれ得る（強制認証）。
/// サブツリー判定は実体解決の後段のため手遅れになる。よって実体に触れる前に弾く。
fn is_network_or_unc(src: &str) -> bool {
    let mut chars = src.trim_start().chars();
    matches!(
        (chars.next(), chars.next()),
        (Some('\\' | '/'), Some('\\' | '/'))
    )
}

/// 画像の実パスを解決する。`md_path` は開いている `.md` の絶対パス、`src` は
/// Markdown 内の画像参照（相対または絶対。呼び出し側で percent-decode 済みを想定）。
///
/// `.md` の親ディレクトリを基準に解決し、実体を `canonicalize` した上で基準配下に
/// 収まる場合のみ実パスを返す。基準配下外（`..` による脱出や無関係な絶対パス）は
/// [`AppError::Forbidden`]。対象が存在しない場合は [`AppError::NotFound`]。
fn resolve_image_path(md_path: &Path, src: &str) -> Result<PathBuf, AppError> {
    // UNC / プロトコル相対は canonicalize が SMB 接続＋NTLM 認証を誘発し得るため、
    // 実体に触れる前に拒否する（is_network_or_unc の doc 参照）。
    if is_network_or_unc(src) {
        return Err(AppError::Forbidden(src.to_string()));
    }

    let base = md_path.parent().unwrap_or_else(|| Path::new("."));
    let requested = Path::new(src);
    let candidate = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        base.join(requested)
    };

    // 実体で正規化してから配下判定する。canonicalize は対象が存在しないと失敗するため、
    // 欠損画像は from_io により NotFound として扱われる。
    let canon_base = fs::canonicalize(base).map_err(|e| AppError::from_io(base, &e))?;
    let canon_target =
        fs::canonicalize(&candidate).map_err(|e| AppError::from_io(&candidate, &e))?;

    if !is_within_base(&canon_base, &canon_target) {
        return Err(AppError::Forbidden(canon_target.display().to_string()));
    }
    Ok(canon_target)
}

/// 実パスの画像を上限チェックの上で読み、`data:{mime};base64,...` を組み立てる。
/// サイズ上限超過は [`AppError::InvalidImage`]、読取失敗は [`AppError`]（from_io）。
fn encode_data_uri(target: &Path, mime: &str, max_bytes: u64) -> Result<String, AppError> {
    let meta = fs::metadata(target).map_err(|e| AppError::from_io(target, &e))?;
    if meta.len() > max_bytes {
        return Err(AppError::InvalidImage(format!(
            "画像が大きすぎます（上限 {} MiB）: {}",
            max_bytes / (1024 * 1024),
            target.display()
        )));
    }
    let bytes = fs::read(target).map_err(|e| AppError::from_io(target, &e))?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(&bytes)))
}

/// ローカル画像を data URI へ変換する純関数（I/O を含むがフロント・Tauri 非依存）。
///
/// # Errors
///
/// 対象が `.md` 配下外なら [`AppError::Forbidden`]、存在しなければ [`AppError::NotFound`]、
/// 未対応形式・サイズ超過は [`AppError::InvalidImage`]、その他の読取失敗は
/// [`AppError::Unreadable`] を返す。
pub fn read_image_as_data_uri(md_path: &Path, src: &str) -> Result<String, AppError> {
    let target = resolve_image_path(md_path, src)?;
    let ext = target
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default();
    let mime = mime_from_extension(ext).ok_or_else(|| {
        AppError::InvalidImage(format!("未対応の画像形式です: {}", target.display()))
    })?;
    encode_data_uri(&target, mime, MAX_IMAGE_BYTES)
}

/// ローカル画像を data URI として返す Tauri コマンド。
///
/// 引数キーはフロントから camelCase（`mdPath` / `src`）で渡り、Tauri が snake_case へ
/// 変換する。`src` はフロント側で percent-decode 済みの参照を想定する。
///
/// # Errors
///
/// [`read_image_as_data_uri`] と同じ条件で [`AppError`] を返す（Display 文字列で届く）。
#[tauri::command]
pub fn read_image_data_uri(md_path: String, src: String) -> Result<String, AppError> {
    read_image_as_data_uri(Path::new(&md_path), &src)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// テスト用の一意な一時ディレクトリを作成する（存在すれば作り直す）。
    fn temp_dir_unique(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mvptr_img_{tag}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    /// 指定パスへバイト列を書き出す。
    fn write_bytes(path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        let mut f = fs::File::create(path).expect("create file");
        f.write_all(bytes).expect("write file");
    }

    #[test]
    fn mime_maps_known_extensions_case_insensitively() {
        assert_eq!(mime_from_extension("png"), Some("image/png"));
        assert_eq!(mime_from_extension("JPG"), Some("image/jpeg"));
        assert_eq!(mime_from_extension("jpeg"), Some("image/jpeg"));
        assert_eq!(mime_from_extension("svg"), Some("image/svg+xml"));
    }

    #[test]
    fn mime_rejects_unknown_extension() {
        assert_eq!(mime_from_extension("exe"), None);
        assert_eq!(mime_from_extension(""), None);
    }

    #[test]
    fn detects_unc_and_protocol_relative_prefixes() {
        assert!(is_network_or_unc("\\\\host\\share\\x.png"));
        assert!(is_network_or_unc("//host/share/x.png"));
        assert!(is_network_or_unc("\\/host"));
        assert!(!is_network_or_unc("images/x.png"));
        assert!(!is_network_or_unc("C:\\x.png"));
        assert!(!is_network_or_unc("/abs/x.png"));
    }

    #[test]
    fn rejects_unc_path_before_touching_filesystem() {
        let dir = temp_dir_unique("unc");
        let md = dir.join("doc.md");
        write_bytes(&md, b"# doc");

        // UNC 参照は canonicalize（SMB/NTLM を誘発し得る）に到達する前に Forbidden。
        let result = read_image_as_data_uri(&md, "\\\\attacker.example.com\\share\\x.png");

        assert!(matches!(result, Err(AppError::Forbidden(_))));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn is_within_base_accepts_child_and_rejects_sibling() {
        let base = Path::new("/root/docs");
        assert!(is_within_base(base, Path::new("/root/docs/img/x.png")));
        assert!(is_within_base(base, base));
        assert!(!is_within_base(base, Path::new("/root/secret.png")));
    }

    #[test]
    fn reads_image_within_base_as_png_data_uri() {
        let dir = temp_dir_unique("within");
        let md = dir.join("doc.md");
        write_bytes(&md, b"# doc");
        // 1x1 透明 PNG の先頭バイト（実データでなくても拡張子とサイズで判定するため十分）。
        write_bytes(&dir.join("images/pic.png"), b"\x89PNG\r\n\x1a\n");

        let uri = read_image_as_data_uri(&md, "images/pic.png").expect("should embed");

        assert!(uri.starts_with("data:image/png;base64,"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_parent_traversal_escaping_base() {
        let dir = temp_dir_unique("traversal");
        let sub = dir.join("sub");
        let md = sub.join("doc.md");
        write_bytes(&md, b"# doc");
        // 基準（sub）の外側に実在する画像。存在するが配下外なので Forbidden になるべき。
        write_bytes(&dir.join("secret.png"), b"\x89PNG\r\n\x1a\n");

        let result = read_image_as_data_uri(&md, "../secret.png");

        assert!(matches!(result, Err(AppError::Forbidden(_))));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn returns_not_found_for_missing_image() {
        let dir = temp_dir_unique("missing");
        let md = dir.join("doc.md");
        write_bytes(&md, b"# doc");

        let result = read_image_as_data_uri(&md, "images/nope.png");

        assert!(matches!(result, Err(AppError::NotFound(_))));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_unsupported_extension() {
        let dir = temp_dir_unique("badext");
        let md = dir.join("doc.md");
        write_bytes(&md, b"# doc");
        write_bytes(&dir.join("payload.exe"), b"MZ");

        let result = read_image_as_data_uri(&md, "payload.exe");

        assert!(matches!(result, Err(AppError::InvalidImage(_))));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_image_exceeding_size_limit() {
        let dir = temp_dir_unique("toobig");
        let img = dir.join("big.png");
        write_bytes(&img, &[0u8; 32]);

        // 上限 5 バイトに対し 32 バイト → InvalidImage。
        let result = encode_data_uri(&img, "image/png", 5);

        assert!(matches!(result, Err(AppError::InvalidImage(_))));
        let _ = fs::remove_dir_all(&dir);
    }
}
