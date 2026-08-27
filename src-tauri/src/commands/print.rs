//! PDF 書き出しコマンド（WebView2 `PrintToPdf`）。
//!
//! `window.print()` は WebView2 の GDI/EMF 印刷経路を通るため、XPS ベースの
//! 「Microsoft Print to PDF」ドライバと組み合わさるとグリフがベクタのアウトライン
//! （パス）へ変換され、生成 PDF のテキストが選択・検索できない。CSS では直せない。
//! `ICoreWebView2_7::PrintToPdf` は Chromium の PDF 生成器を直接使い、フォントを
//! 埋め込んだテキストとして出力するため、PDF 保存はこちらへ寄せる
//! （物理プリンタ向けの `window.print()` は別導線として残す）。
//!
//! ロジックのうち Tauri / COM に触れない部分は純関数へ分離し、`#[tauri::command]`
//! は薄いラッパにしてテスト可能にする。

use crate::error::AppError;

/// 保存先パスに `.pdf` 拡張子を補う純関数。既に `.pdf`（大文字小文字無視）なら
/// そのまま返す。ダイアログでユーザーが拡張子を消して確定できるため境界で正す。
pub fn ensure_pdf_extension(path: &str) -> String {
    if path.to_ascii_lowercase().ends_with(".pdf") {
        path.to_string()
    } else {
        format!("{path}.pdf")
    }
}

/// 用紙余白（ミリメートル）。値の出どころはフロント（`core/print.ts`）に一本化し、
/// 画面の `@page` と PDF 書き出しで同じ数値を使う。
#[derive(serde::Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct PageMarginsMm {
    pub vertical: f64,
    pub horizontal: f64,
}

/// PDF を書き出す Tauri コマンド。
///
/// `path` は保存先の絶対パス（フロントの保存ダイアログで取得）、`headerTitle` は
/// 各ページのヘッダー中央に出すタイトル（通常は MD のファイル名の語幹）、
/// `marginsMm` は用紙余白（フロントの単一定数から渡る）。
/// 完了は WebView2 の非同期コールバックで届くため、チャネルで待ち合わせる。
///
/// # Errors
///
/// WebView2 の取得・設定・書き出しに失敗した場合、完了通知が期限内に届かない場合、
/// または Windows 以外のプラットフォームで呼ばれた場合に [`AppError::Print`] を返す。
#[tauri::command]
pub async fn print_to_pdf(
    window: tauri::WebviewWindow,
    path: String,
    header_title: String,
    margins_mm: PageMarginsMm,
) -> Result<(), AppError> {
    imp::print_to_pdf(
        window,
        ensure_pdf_extension(&path),
        header_title,
        margins_mm,
    )
    .await
}

#[cfg(windows)]
mod imp {
    use super::{AppError, PageMarginsMm};

    use std::time::Duration;
    use tauri::WebviewWindow;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_2, ICoreWebView2_7, ICoreWebView2Environment6, ICoreWebView2PrintSettings,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{HSTRING, Interface};

    /// 1 インチのミリメートル数（印刷設定はインチで受け取る）。
    const MM_PER_INCH: f64 = 25.4;

    /// 完了通知の待ち上限。COM のコールバックが何らかの理由で一度も発火しない場合に
    /// コマンドが永久に解決せず、フロントの書き出し状態が戻らなくなるのを防ぐ。
    const COMPLETION_TIMEOUT: Duration = Duration::from_secs(120);

    /// COM の失敗を利用者向けエラーへ写像する。内部構造は晒さずメッセージのみ渡す。
    fn to_print_error(err: &windows::core::Error) -> AppError {
        AppError::Print(err.message().to_string())
    }

    /// 書き出し設定を組み立てる。
    ///
    /// ヘッダー/フッターは Chromium 側のテンプレートを使う（`@page` のマージンボックスは
    /// Chromium 未実装で効かないため、CSS ではなくここで指定する）。`FooterUri` を空に
    /// すると URL は消え、ページ番号だけが残る。
    unsafe fn build_settings(
        env: &ICoreWebView2Environment6,
        header_title: &str,
        margins_mm: PageMarginsMm,
    ) -> windows::core::Result<ICoreWebView2PrintSettings> {
        let settings = unsafe { env.CreatePrintSettings() }?;
        let vertical = margins_mm.vertical / MM_PER_INCH;
        let horizontal = margins_mm.horizontal / MM_PER_INCH;
        unsafe {
            settings.SetShouldPrintBackgrounds(true)?;
            settings.SetShouldPrintHeaderAndFooter(true)?;
            settings.SetHeaderTitle(&HSTRING::from(header_title))?;
            settings.SetFooterUri(&HSTRING::from(""))?;
            settings.SetMarginTop(vertical)?;
            settings.SetMarginBottom(vertical)?;
            settings.SetMarginLeft(horizontal)?;
            settings.SetMarginRight(horizontal)?;
        }
        Ok(settings)
    }

    /// メインスレッド上で `PrintToPdf` を起動する。完了は `tx` へ送られる。
    unsafe fn start_print(
        platform: &tauri::webview::PlatformWebview,
        path: &str,
        header_title: &str,
        margins_mm: PageMarginsMm,
        tx: tauri::async_runtime::Sender<Result<(), AppError>>,
    ) -> windows::core::Result<()> {
        let core = unsafe { platform.controller().CoreWebView2() }?;
        let env = unsafe { core.cast::<ICoreWebView2_2>()?.Environment() }?;
        let settings = unsafe {
            build_settings(
                &env.cast::<ICoreWebView2Environment6>()?,
                header_title,
                margins_mm,
            )
        }?;

        let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, is_successful| {
            let outcome = match result {
                Err(err) => Err(to_print_error(&err)),
                Ok(()) if is_successful => Ok(()),
                // 呼び出し自体は成功だが is_successful が false のケース（保存先へ書けない等）。
                Ok(()) => Err(AppError::Print(
                    "保存先へ書き出せませんでした（パスと権限を確認してください）".to_string(),
                )),
            };
            let _ = tx.try_send(outcome);
            Ok(())
        }));

        unsafe {
            core.cast::<ICoreWebView2_7>()?
                .PrintToPdf(&HSTRING::from(path), &settings, &handler)
        }
    }

    pub async fn print_to_pdf(
        window: WebviewWindow,
        path: String,
        header_title: String,
        margins_mm: PageMarginsMm,
    ) -> Result<(), AppError> {
        // 完了通知は WebView2 のコールバック（メインスレッド）から届く。容量 1 で足りる。
        let (tx, mut rx) = tauri::async_runtime::channel::<Result<(), AppError>>(1);
        let error_tx = tx.clone();

        // COM 呼び出しは WebView を所有するスレッドで行う必要がある。
        window
            .with_webview(move |platform| {
                if let Err(err) =
                    unsafe { start_print(&platform, &path, &header_title, margins_mm, tx) }
                {
                    let _ = error_tx.try_send(Err(to_print_error(&err)));
                }
            })
            .map_err(|err| AppError::Print(err.to_string()))?;

        match tokio::time::timeout(COMPLETION_TIMEOUT, rx.recv()).await {
            Ok(Some(outcome)) => outcome,
            // 送信側が全て drop された（コールバックが結果を送らず消えた）。
            Ok(None) => Err(AppError::Print(
                "完了通知を受け取れませんでした".to_string(),
            )),
            Err(_) => Err(AppError::Print(format!(
                "書き出しが {} 秒以内に完了しませんでした",
                COMPLETION_TIMEOUT.as_secs()
            ))),
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::{AppError, PageMarginsMm};

    /// Windows 以外は WebView2 が無い。Windows 専用アプリのため未対応として失敗させる
    /// （非 Windows でも `cargo test` が通るようにするためのスタブ）。
    pub async fn print_to_pdf(
        _window: tauri::WebviewWindow,
        _path: String,
        _header_title: String,
        _margins_mm: PageMarginsMm,
    ) -> Result<(), AppError> {
        Err(AppError::Print(
            "このプラットフォームでは PDF 書き出しに対応していません".to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_pdf_extension_when_missing() {
        assert_eq!(ensure_pdf_extension(r"C:\docs\note"), r"C:\docs\note.pdf");
    }

    #[test]
    fn keeps_existing_pdf_extension_case_insensitively() {
        assert_eq!(ensure_pdf_extension(r"C:\docs\a.pdf"), r"C:\docs\a.pdf");
        assert_eq!(ensure_pdf_extension(r"C:\docs\a.PDF"), r"C:\docs\a.PDF");
    }

    #[test]
    fn appends_extension_for_names_with_other_suffixes() {
        assert_eq!(ensure_pdf_extension("note.md"), "note.md.pdf");
    }
}
