//! 起動引数コマンド。
//!
//! コマンドラインに渡された `.md` / `.markdown` パスを抽出する。
//! 抽出ロジックは純関数 `extract_md_paths` に分離してテスト可能にする。

/// パスが絶対パスに見えるかを判定する（プラットフォーム非依存）。
///
/// `Path::is_absolute` は実行中の OS の規則で判定するため、Windows のドライブ
/// パス（`C:\...`）が非 Windows のテストで絶対と見なされない。引数の解釈は
/// OS 間で揺れてはいけないので、ドライブレターと POSIX ルートを自前で見る。
fn looks_absolute(path: &str) -> bool {
    let bytes = path.as_bytes();
    if matches!(bytes.first(), Some(b'/' | b'\\')) {
        return true;
    }
    // `C:\` / `C:/` 形式。
    matches!(
        (bytes.first(), bytes.get(1), bytes.get(2)),
        (Some(c), Some(b':'), Some(b'\\' | b'/')) if c.is_ascii_alphabetic()
    )
}

/// Markdown 拡張子（`.md` / `.markdown`）かを判定する。大文字小文字は無視する。
fn has_markdown_extension(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

/// スイッチ形式で渡されたパスを素のパスへ戻す。
///
/// ランチャ（msedgedriver 等の Chromium 系 WebDriver）はファイルパスを `--<path>`
/// のスイッチ形式で渡すため、先頭のハイフンを除去する必要がある。ただし無条件に
/// 剥がすと `-memo.md` のようなハイフン始まりの正規のファイル名が別パスへ化ける。
/// ランチャが渡すのは常に絶対パスなので、「剥がした結果が絶対パスのときだけ」
/// 剥がすことで両立させる。
fn unwrap_switch_style(arg: &str) -> &str {
    let stripped = arg.trim_start_matches('-');
    if stripped.len() != arg.len() && looks_absolute(stripped) {
        stripped
    } else {
        arg
    }
}

/// 引数列から Markdown ファイルパスを抽出する。先頭（プログラム名）は除外する。
pub fn extract_md_paths<I>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    args.into_iter()
        .skip(1)
        .map(|arg| unwrap_switch_style(&arg).to_string())
        .filter(|arg| has_markdown_extension(arg))
        .collect()
}

/// プロセスの起動引数を文字列として読む。
///
/// `std::env::args()` は非 Unicode な引数があると panic する（std の仕様）。
/// Windows の argv は UTF-16 由来で不対サロゲートを含み得るため、`args_os` で
/// 受けて lossy 変換する。panic すると起動時のコマンドがそのまま失敗する。
fn args_lossy() -> impl Iterator<Item = String> {
    std::env::args_os().map(|arg| arg.to_string_lossy().into_owned())
}

/// 起動時の引数から開くべき Markdown パス一覧を返す Tauri コマンド。
#[tauri::command]
pub fn get_launch_files() -> Vec<String> {
    extract_md_paths(args_lossy())
}

/// 起動引数のテーマ指定を正規化する。
///
/// `--theme <v>` と `--theme=<v>` の両形式に対応する。値は小文字化して照合し、
/// `dark` / `light` のみを採用、未指定・不正値・値欠落はすべて `"system"`
/// （OS 追従へ委譲）へ正規化する。`.md` パス抽出（`extract_md_paths`）
/// とは独立しており、テーマ値（dark/light/system）は拡張子フィルタで弾かれるため
/// 相互に干渉しない。
pub fn extract_theme_arg<I>(args: I) -> &'static str
where
    I: IntoIterator<Item = String>,
{
    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        if let Some(value) = arg.strip_prefix("--theme=") {
            return normalize_theme(value);
        }
        if arg == "--theme" {
            return match iter.next() {
                Some(value) => normalize_theme(&value),
                None => "system",
            };
        }
    }
    "system"
}

/// テーマ文字列を `"dark"` / `"light"` / `"system"` のいずれかへ正規化する。
fn normalize_theme(value: &str) -> &'static str {
    match value.to_lowercase().as_str() {
        "dark" => "dark",
        "light" => "light",
        _ => "system",
    }
}

/// 2 回目以降の起動から転送され、まだフロントが取り出していないパスの控え。
///
/// `open-files` イベントの送出だけに頼ると、起動直後（フロントが購読を確立する
/// 前の数百ミリ秒）に届いた転送が受け手不在で消え、「ダブルクリックしたのに
/// 何も起きない」になる。イベントは「取りに来い」の合図に留め、実体はここへ
/// 積んでフロントが [`take_pending_open_files`] で回収する。
#[derive(Default)]
pub struct PendingOpenFiles(std::sync::Mutex<Vec<String>>);

impl PendingOpenFiles {
    /// 転送されたパスを積む。ロックが毒されていても内部値を回収して継続する。
    pub fn push(&self, paths: Vec<String>) {
        let mut pending = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        pending.extend(paths);
    }

    /// 積まれたパスを全て取り出して空にする。
    pub fn take(&self) -> Vec<String> {
        let mut pending = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        std::mem::take(&mut *pending)
    }
}

/// 転送済みで未処理の Markdown パスを取り出す Tauri コマンド（取り出すと空になる）。
#[tauri::command]
pub fn take_pending_open_files(pending: tauri::State<'_, PendingOpenFiles>) -> Vec<String> {
    pending.take()
}

/// 起動引数で指定されたテーマを返す Tauri コマンド。
///
/// 戻り値は `"dark"` / `"light"` / `"system"` のいずれか。フロントは Zod で
/// 再検証し、`"dark"`/`"light"` は固定適用・`"system"` は OS 追従する。
#[tauri::command]
pub fn get_launch_theme() -> String {
    extract_theme_arg(args_lossy()).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn skips_program_name_and_extracts_md() {
        let result = extract_md_paths(args(&["markview.exe", "C:\\docs\\a.md"]));
        assert_eq!(result, vec!["C:\\docs\\a.md".to_string()]);
    }

    #[test]
    fn extracts_multiple_md_paths() {
        let result = extract_md_paths(args(&["app", "a.md", "b.markdown"]));
        assert_eq!(result, vec!["a.md".to_string(), "b.markdown".to_string()]);
    }

    #[test]
    fn ignores_non_markdown_arguments() {
        let result = extract_md_paths(args(&["app", "--flag", "image.png", "note.md"]));
        assert_eq!(result, vec!["note.md".to_string()]);
    }

    #[test]
    fn matches_extension_case_insensitively() {
        let result = extract_md_paths(args(&["app", "README.MD", "Doc.Markdown"]));
        assert_eq!(
            result,
            vec!["README.MD".to_string(), "Doc.Markdown".to_string()]
        );
    }

    #[test]
    fn returns_empty_when_no_md_arguments() {
        let result = extract_md_paths(args(&["app"]));
        assert!(result.is_empty());
    }

    #[test]
    fn strips_leading_hyphens_from_switch_style_absolute_paths() {
        // msedgedriver（Chromium 系 WebDriver）等のランチャはファイルパスを
        // `--<path>` のスイッチ形式（常に絶対パス）で渡す。
        let result = extract_md_paths(args(&["app", "--C:\\docs\\a.md", "--/tmp/b.markdown"]));
        assert_eq!(
            result,
            vec!["C:\\docs\\a.md".to_string(), "/tmp/b.markdown".to_string()]
        );
    }

    #[test]
    fn keeps_hyphen_leading_relative_file_names_intact() {
        // `-memo.md` は Windows でも合法なファイル名。剥がすと別ファイルへ化けるため、
        // 相対パスのままのものはハイフンを保持する。
        let result = extract_md_paths(args(&["app", "-memo.md", "--draft.markdown"]));
        assert_eq!(
            result,
            vec!["-memo.md".to_string(), "--draft.markdown".to_string()]
        );
    }

    #[test]
    fn detects_absolute_paths_across_platforms() {
        assert!(looks_absolute("C:\\docs\\a.md"));
        assert!(looks_absolute("c:/docs/a.md"));
        assert!(looks_absolute("/tmp/a.md"));
        assert!(looks_absolute("\\\\server\\share\\a.md"));
        assert!(!looks_absolute("memo.md"));
        assert!(!looks_absolute("docs/memo.md"));
        assert!(!looks_absolute("C:memo.md"));
    }

    // ---- テーマ起動引数 ----

    #[test]
    fn theme_space_form_dark() {
        assert_eq!(extract_theme_arg(args(&["app", "--theme", "dark"])), "dark");
    }

    #[test]
    fn theme_equals_form_light() {
        assert_eq!(extract_theme_arg(args(&["app", "--theme=light"])), "light");
    }

    #[test]
    fn theme_explicit_system() {
        assert_eq!(
            extract_theme_arg(args(&["app", "--theme", "system"])),
            "system"
        );
    }

    #[test]
    fn theme_is_case_insensitive() {
        assert_eq!(extract_theme_arg(args(&["app", "--theme=DARK"])), "dark");
    }

    #[test]
    fn theme_invalid_value_falls_back_to_system() {
        assert_eq!(
            extract_theme_arg(args(&["app", "--theme", "blue"])),
            "system"
        );
    }

    #[test]
    fn theme_missing_value_falls_back_to_system() {
        assert_eq!(extract_theme_arg(args(&["app", "--theme"])), "system");
    }

    #[test]
    fn theme_unspecified_defaults_to_system() {
        assert_eq!(
            extract_theme_arg(args(&["app", "C:\\docs\\a.md"])),
            "system"
        );
    }

    #[test]
    fn theme_arg_does_not_leak_into_md_paths() {
        // テーマ引数とその値が .md パス抽出に混入しないこと（回帰防止）。
        let argv = args(&["app", "--theme", "dark", "C:\\docs\\note.md"]);
        assert_eq!(extract_md_paths(argv.clone()), vec!["C:\\docs\\note.md"]);
        assert_eq!(extract_theme_arg(argv), "dark");
    }
}
