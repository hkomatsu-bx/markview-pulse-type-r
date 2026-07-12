// Windows のリリースビルドで余計なコンソール窓を出さない（重要：削除禁止）。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;

/// 配線のみの薄いエントリポイント。ロジックは `markview_lib::run` に集約する。
fn main() -> ExitCode {
    if let Err(err) = markview_lib::run() {
        eprintln!("アプリケーションの実行に失敗しました: {err}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
