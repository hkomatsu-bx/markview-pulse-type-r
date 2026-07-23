//! Markview Pulse Type R — Rust コアのエントリポイント。
//!
//! Tauri builder を構築し、dialog プラグイン・コマンド・`WatchManager` を登録する。

mod commands;
mod error;
mod watcher;

use watcher::WatchManager;

/// Tauri アプリケーションを構築して起動する。
///
/// dialog プラグイン・コマンド・[`WatchManager`] を builder に登録し、イベントループを開始する。
/// ロジックを lib に寄せ、`main` は本関数の `Err` を受けて終了コードを制御する。
///
/// # Errors
///
/// Tauri context の生成失敗、またはイベントループの異常終了時に [`tauri::Error`] を返す。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> tauri::Result<()> {
    let builder = tauri::Builder::default();

    // single-instance は最も外側（最初）に登録する（Tauri 公式の要件）。
    // 2 回目以降の起動はここで捕捉し、起動引数の .md を既存ウィンドウへ転送して
    // 前面化する。新規プロセス（新ウィンドウ）は plugin 側で終了させられる。
    // 「送る」やファイル関連付けからの追加起動でもウィンドウは 1 つに保たれる。
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        use tauri::{Emitter, Manager};

        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        let files = commands::cli::extract_md_paths(argv);
        if !files.is_empty() {
            // フロントは open-files を購読し、各パスをタブで開く。
            let _ = app.emit("open-files", files);
        }
    }));

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(WatchManager::new())
        .invoke_handler(tauri::generate_handler![
            commands::file::read_markdown_file,
            commands::image::read_image_data_uri,
            commands::watcher::start_watch,
            commands::watcher::stop_watch,
            commands::cli::get_launch_files,
            commands::cli::get_launch_theme,
        ])
        .run(tauri::generate_context!())
}
