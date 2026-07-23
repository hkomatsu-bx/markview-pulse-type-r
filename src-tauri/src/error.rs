//! アプリケーションエラー型。
//!
//! `thiserror` で利用者向けの日本語メッセージを持つ列挙型を定義する。
//! Tauri コマンドの `Result<T, AppError>` 戻り値はフロントへ JSON 化されるため、
//! `serde::Serialize` を Display 文字列として手実装し、エラー内容を伝える。

use std::io;
use std::path::Path;

/// 利用者向けエラー。コマンド境界で JSON 文字列として返る。
#[derive(thiserror::Error, Debug)]
pub enum AppError {
    #[error("ファイルが見つかりません: {0}")]
    NotFound(String),
    #[error("ファイルを読み取れません: {0}")]
    Unreadable(String),
    #[error("監視を開始できません: {0}")]
    Watch(String),
    #[error("アクセスが許可されていません: {0}")]
    Forbidden(String),
    #[error("画像を処理できません: {0}")]
    InvalidImage(String),
}

impl AppError {
    /// I/O エラーを対象パス付きで `AppError` へ写像する。
    /// `NotFound` のみ専用バリアントへ、それ以外は `Unreadable` へ集約する。
    pub fn from_io(path: &Path, err: &io::Error) -> Self {
        let target = path.display().to_string();
        match err.kind() {
            io::ErrorKind::NotFound => AppError::NotFound(target),
            _ => AppError::Unreadable(format!("{target}: {err}")),
        }
    }
}

// Tauri コマンドのエラーは Serialize 必須。エラーメッセージで内部情報を漏らさないため、
// 内部構造は晒さず Display 文字列のみ返す。
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::ErrorKind;

    #[test]
    fn maps_not_found_io_error_to_not_found_variant() {
        let path = Path::new("/missing/file.md");
        let io_err = io::Error::new(ErrorKind::NotFound, "no such file");

        let app_err = AppError::from_io(path, &io_err);

        assert!(matches!(app_err, AppError::NotFound(_)));
    }

    #[test]
    fn maps_permission_denied_to_unreadable_variant() {
        let path = Path::new("/locked/file.md");
        let io_err = io::Error::new(ErrorKind::PermissionDenied, "denied");

        let app_err = AppError::from_io(path, &io_err);

        assert!(matches!(app_err, AppError::Unreadable(_)));
    }

    #[test]
    fn not_found_message_contains_japanese_label_and_path() {
        let err = AppError::NotFound("/a/b.md".to_string());
        let message = err.to_string();
        assert!(message.contains("ファイルが見つかりません"));
        assert!(message.contains("/a/b.md"));
    }

    #[test]
    fn serializes_as_display_string() {
        let err = AppError::Watch("notify failed".to_string());
        let json = serde_json::to_string(&err).expect("serialize");
        assert_eq!(json, "\"監視を開始できません: notify failed\"");
    }
}
