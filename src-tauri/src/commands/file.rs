//! ファイル読込コマンド。
//!
//! `read_markdown_file` は薄い Tauri ラッパで、ロジックは純関数
//! `read_file_content` に分離してテスト可能にする。

use std::fs;
use std::io::Read;
use std::path::Path;
use std::time::UNIX_EPOCH;

use crate::error::AppError;

/// ファイル内容と最終更新時刻（epoch ミリ秒）。
/// フロントの `FileContent`（`modifiedMs`）に合わせ camelCase で直列化する。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    // フィールドはクレート内で構築・参照するのみ（serde 直列化は可視性を問わない）。
    // 外部からの直接構築・書き換えを許さないため pub(crate) に絞る。
    pub(crate) path: String,
    pub(crate) content: String,
    /// 最終更新時刻（epoch ミリ秒）。取得できない場合は 0（不明）。
    pub(crate) modified_ms: u64,
}

/// 指定パスの Markdown を読み込む純関数。I/O エラーは `AppError` へ写像する。
///
/// 内容と更新時刻は同一ファイルハンドルから取得し、read と stat の間で
/// ファイルが書き換わっても content と modified_ms が不整合にならないようにする。
/// 更新時刻を取得できない場合、`modified_ms` は 0（不明）になる。
///
/// # Errors
///
/// ファイルが存在しない場合は [`AppError::NotFound`]、その他の I/O 失敗（権限・読取エラー等）は
/// [`AppError::Unreadable`] を返す。
pub fn read_file_content(path: &Path) -> Result<FileContent, AppError> {
    let mut file = fs::File::open(path).map_err(|e| AppError::from_io(path, &e))?;
    let modified_ms = file
        .metadata()
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .and_then(|dur| u64::try_from(dur.as_millis()).ok())
        .unwrap_or(0);
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| AppError::from_io(path, &e))?;

    Ok(FileContent {
        path: path.display().to_string(),
        content,
        modified_ms,
    })
}

/// Markdown ファイルを読み込む Tauri コマンド。
///
/// # Errors
///
/// [`read_file_content`] と同じ条件で [`AppError`] を返す（フロントには Display 文字列として届く）。
#[tauri::command]
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
    fn populates_modified_ms_for_existing_file() {
        let path = write_temp("read_mtime", "x");

        let result = read_file_content(&path).expect("should read");

        assert!(result.modified_ms > 0, "modified_ms should be set");
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
