//! ファイル読込コマンド。
//!
//! `read_markdown_file` は薄い Tauri ラッパで、ロジックは純関数
//! `read_file_content` に分離してテスト可能にする。

use std::fs;
use std::io::Read;
use std::path::Path;

use crate::error::AppError;

/// ファイル内容。フロントの `FileContent` に合わせ camelCase で直列化する。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    // フィールドはクレート内で構築・参照するのみ（serde 直列化は可視性を問わない）。
    // 外部からの直接構築・書き換えを許さないため pub(crate) に絞る。
    pub(crate) path: String,
    pub(crate) content: String,
}

/// 指定パスの Markdown を読み込む純関数。I/O エラーは `AppError` へ写像する。
///
/// # Errors
///
/// ファイルが存在しない場合は [`AppError::NotFound`]、その他の I/O 失敗（権限・読取エラー等）は
/// [`AppError::Unreadable`] を返す。
pub fn read_file_content(path: &Path) -> Result<FileContent, AppError> {
    let mut file = fs::File::open(path).map_err(|e| AppError::from_io(path, &e))?;
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| AppError::from_io(path, &e))?;

    // 先頭の UTF-8 BOM を除去する。Windows のメモ帳 / PowerShell 等が付与し、
    // 残すとフロント側でフロントマターの `---` 検出や見出し解釈を阻害するため。
    if content.starts_with('\u{feff}') {
        content.replace_range(..'\u{feff}'.len_utf8(), "");
    }

    Ok(FileContent {
        path: path.display().to_string(),
        content,
    })
}

/// Markdown ファイルを読み込む Tauri コマンド。
///
/// `(async)` 指定は必須。非 async のコマンドはメインスレッド（WebView のイベント
/// ループ）で同期実行されるため、ネットワークドライブ上や巨大なファイルの読取が
/// そのままウィンドウのフリーズになる。
///
/// # Errors
///
/// [`read_file_content`] と同じ条件で [`AppError`] を返す（フロントには Display 文字列として届く）。
#[tauri::command(async)]
pub fn read_markdown_file(path: String) -> Result<FileContent, AppError> {
    read_file_content(Path::new(&path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// テスト用の一意な一時ファイルを作成して内容を返す。
    fn write_temp(name: &str, content: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("mvptr_{name}.md"));
        let mut f = fs::File::create(&path).expect("create temp");
        f.write_all(content.as_bytes()).expect("write temp");
        path
    }

    #[test]
    fn reads_existing_file_content() {
        let path = write_temp("read_existing", "# 見出し\n本文");

        let result = read_file_content(&path).expect("should read");

        assert_eq!(result.content, "# 見出し\n本文");
        assert!(result.path.contains("mvptr_read_existing.md"));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn strips_leading_utf8_bom() {
        let path = write_temp("read_bom", "\u{feff}---\ntitle: x\n---\n# 見出し");

        let result = read_file_content(&path).expect("should read");

        assert_eq!(result.content, "---\ntitle: x\n---\n# 見出し");
        assert!(!result.content.starts_with('\u{feff}'));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn returns_not_found_for_missing_file() {
        let path = std::env::temp_dir().join("mvptr_definitely_missing_8f3a.md");
        let _ = fs::remove_file(&path);

        let result = read_file_content(&path);

        assert!(matches!(result, Err(AppError::NotFound(_))));
    }
}
