//! 起動引数コマンド。
//!
//! コマンドラインに渡された `.md` / `.markdown` パスを抽出する。
//! 抽出ロジックは純関数 `extract_md_paths` に分離してテスト可能にする。

/// 引数列から Markdown ファイルパスを抽出する。先頭（プログラム名）は除外する。
///
/// ランチャ（msedgedriver 等の Chromium 系 WebDriver）はファイルパスを `--<path>`
/// のスイッチ形式で渡すことがあるため、先頭の連続ハイフンを除去してパスとして扱う。
/// 実運用の素のパス（`C:\...\a.md`）はハイフンを持たないため挙動は変わらない。
pub fn extract_md_paths<I>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    args.into_iter()
        .skip(1)
        .map(|arg| arg.trim_start_matches('-').to_string())
        .filter(|arg| {
            let lower = arg.to_lowercase();
            lower.ends_with(".md") || lower.ends_with(".markdown")
        })
        .collect()
}

/// 起動時の引数から開くべき Markdown パス一覧を返す Tauri コマンド。
#[tauri::command]
pub fn get_launch_files() -> Vec<String> {
    extract_md_paths(std::env::args())
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

/// 起動引数で指定されたテーマを返す Tauri コマンド。
///
/// 戻り値は `"dark"` / `"light"` / `"system"` のいずれか。フロントは Zod で
/// 再検証し、`"dark"`/`"light"` は固定適用・`"system"` は OS 追従する。
#[tauri::command]
pub fn get_launch_theme() -> String {
    extract_theme_arg(std::env::args()).to_string()
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
    fn strips_leading_hyphens_from_switch_style_paths() {
        // msedgedriver（Chromium 系 WebDriver）等のランチャはファイルパスを
        // `--<path>` のスイッチ形式で渡す。位置引数として受けたパスは先頭の
        // ハイフンを除去して扱う（実運用の素のパスには影響しない）。
        let result = extract_md_paths(args(&["app", "--C:\\docs\\a.md", "--b.markdown"]));
        assert_eq!(
            result,
            vec!["C:\\docs\\a.md".to_string(), "b.markdown".to_string()]
        );
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
