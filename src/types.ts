// アプリ全体で共有する型定義。

import type { ViewMode } from "./core/view/viewMode";

export type TabId = string;
export type AppTheme = "light" | "dark";

/**
 * 起動引数で指定可能なテーマ。`AppTheme` と異なり `"system"` を含む。
 * `"dark"`/`"light"` は固定適用、`"system"` は OS 追従へ委譲する。
 */
export type LaunchTheme = "light" | "dark" | "system";

/** Rust の read_markdown_file が返すファイル内容。 */
export interface FileContent {
  readonly path: string;
  readonly content: string;
  readonly modifiedMs: number;
}

/** 1 つのタブの状態。全フィールド readonly（不変更新）。 */
export interface Tab {
  readonly id: TabId;
  readonly path: string;
  readonly fileName: string;
  readonly source: string; // 現在のソース
  readonly previousSource: string; // 差分基準（前回内容）
  readonly viewMode: ViewMode;
  readonly isWatching: boolean;
}

export type DiffOpKind = "equal" | "insert" | "delete";

/** 差分エンジンが返す 1 操作。 */
export interface DiffOp {
  readonly kind: DiffOpKind;
  readonly text: string;
}

/** Rust → JS の file-changed イベントのペイロード。 */
export interface FileChangedEvent {
  readonly tabId: string;
  readonly path: string;
}

/** Rust → JS の watch-error イベントのペイロード。 */
export interface WatchErrorEvent {
  readonly tabId: string;
  readonly message: string;
}
