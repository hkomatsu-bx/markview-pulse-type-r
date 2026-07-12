//! 変更監視コマンドとイベント送出。
//!
//! `WatchManager`（Tauri 非依存）に `AppHandle` を包んだ emitter を渡し、
//! 変更を `file-changed` / `watch-error` イベントとしてフロントへ通知する。
//! イベントには内容を含めず、フロントが `read_markdown_file` で再読込する。

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};

use crate::watcher::{ChangeEmitter, WatchManager};

/// `file-changed` のペイロード。フロントの `FileChangedEvent` に合わせ camelCase。
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileChangedEvent {
    pub tab_id: String,
    pub path: String,
}

/// `watch-error` のペイロード。フロントの `WatchErrorEvent` に合わせ camelCase。
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatchErrorEvent {
    pub tab_id: String,
    pub message: String,
}

/// `AppHandle` を包み、変更を Tauri イベントへ橋渡しする emitter。
struct TauriEmitter {
    app: AppHandle,
}

impl ChangeEmitter for TauriEmitter {
    fn file_changed(&self, tab_id: &str, path: &str) {
        // 送出失敗（ウィンドウ消失・直列化失敗など）でも監視スレッドは継続させるが、
        // 握りつぶさず手掛かりを残す。
        if let Err(e) = self.app.emit(
            "file-changed",
            FileChangedEvent {
                tab_id: tab_id.to_string(),
                path: path.to_string(),
            },
        ) {
            eprintln!("[watcher] file-changed の送出に失敗 (tab={tab_id}): {e}");
        }
    }

    fn watch_error(&self, tab_id: &str, message: &str) {
        if let Err(e) = self.app.emit(
            "watch-error",
            WatchErrorEvent {
                tab_id: tab_id.to_string(),
                message: message.to_string(),
            },
        ) {
            eprintln!("[watcher] watch-error の送出に失敗 (tab={tab_id}): {e}");
        }
    }
}

/// 指定タブのファイル監視を開始する。
#[tauri::command]
pub fn start_watch(app: AppHandle, manager: State<'_, WatchManager>, tab_id: String, path: String) {
    let emitter: Arc<dyn ChangeEmitter> = Arc::new(TauriEmitter { app });
    manager.start_watch(tab_id, PathBuf::from(path), emitter);
}

/// 指定タブのファイル監視を停止する。
#[tauri::command]
pub fn stop_watch(manager: State<'_, WatchManager>, tab_id: String) {
    manager.stop_watch(&tab_id);
}
