// フロント → Rust の IPC ラッパ。
//
// Tauri コマンド名は Rust 側 snake_case。invoke の引数キーは camelCase で渡し、
// Tauri が snake_case パラメータ（tab_id 等）へ自動変換する。
// イベント file-changed / watch-error は内容を載せず（tabId/path/message のみ）、
// フロントが read_markdown_file で再読込する設計。

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openPath } from "@tauri-apps/plugin-opener";
import { z } from "zod";

import type {
  FileContent,
  FileChangedEvent,
  WatchErrorEvent,
  LaunchTheme,
} from "../../types";

// 型は実行時に消えるため、IPC 境界（Rust→JS）の値は Zod スキーマで検証する。
const fileContentSchema = z.object({
  path: z.string(),
  content: z.string(),
  modifiedMs: z.number(),
});
const launchFilesSchema = z.array(z.string());
// 起動テーマ。wire を信用せず enum 検証し、不正は "system" へ正規化する。
const launchThemeSchema = z.enum(["light", "dark", "system"]);
const fileChangedSchema = z.object({
  tabId: z.string(),
  path: z.string(),
});
const watchErrorSchema = z.object({
  tabId: z.string(),
  message: z.string(),
});
// drop 種別のペイロードに含まれるパス配列。境界で検証する。
const dragDropPayloadSchema = z.object({
  paths: z.array(z.string()),
});

/** ドラッグ&ドロップの種別と、drop 時のパス。 */
export interface FileDropEvent {
  readonly kind: "enter" | "over" | "drop" | "leave";
  readonly paths: readonly string[];
}

// data URI 検証。wire を信用せず、data: 前置の文字列であることを境界で確認する。
const imageDataUriSchema = z.string().refine((s) => s.startsWith("data:"), {
  message: "data URI ではありません",
});

/** 指定パスの Markdown を読み込む。 */
export async function readMarkdownFile(path: string): Promise<FileContent> {
  return fileContentSchema.parse(await invoke("read_markdown_file", { path }));
}

/**
 * ローカル画像を data URI として読み込む。
 * `mdPath` は開いている .md の絶対パス、`src` は Markdown 内の画像参照
 * （percent-decode 済み）。読取は .md 配下に限定される（Rust 側で担保）。
 */
export async function readImageDataUri(
  mdPath: string,
  src: string,
): Promise<string> {
  return imageDataUriSchema.parse(
    await invoke("read_image_data_uri", { mdPath, src }),
  );
}

/**
 * アクティブなファイルを OS 既定アプリ（エディタ等）で開く。
 * opener プラグイン経由。失敗時は例外を伝播し、呼び出し側が reportError する。
 */
export async function openInEditor(path: string): Promise<void> {
  await openPath(path);
}

/** 指定タブのファイル監視を開始する。 */
export async function startWatch(tabId: string, path: string): Promise<void> {
  await invoke("start_watch", { tabId, path });
}

/** 指定タブのファイル監視を停止する。 */
export async function stopWatch(tabId: string): Promise<void> {
  await invoke("stop_watch", { tabId });
}

/** 起動引数で渡された Markdown パス一覧を取得する（CLI 起動）。 */
export async function getLaunchFiles(): Promise<string[]> {
  return launchFilesSchema.parse(await invoke("get_launch_files"));
}

/**
 * 起動引数で指定されたテーマを取得する。
 * 不正な値・取得失敗時は OS 追従（"system"）へ正規化し、起動を妨げない。
 */
export async function getLaunchTheme(): Promise<LaunchTheme> {
  const parsed = launchThemeSchema.safeParse(await invoke("get_launch_theme"));
  return parsed.success ? parsed.data : "system";
}

/**
 * 2 回目以降の起動（single-instance）で転送された Markdown パスを購読する。
 * Rust 側が起動引数から抽出して emit する。戻り値は購読解除関数。
 */
export function onOpenFiles(
  handler: (paths: string[]) => void,
): Promise<UnlistenFn> {
  return listen("open-files", (event) => {
    const parsed = launchFilesSchema.safeParse(event.payload);
    if (parsed.success) {
      handler(parsed.data);
    }
  });
}

/** file-changed を購読する。戻り値は購読解除関数。 */
export function onFileChanged(
  handler: (event: FileChangedEvent) => void,
): Promise<UnlistenFn> {
  return listen("file-changed", (event) => {
    const parsed = fileChangedSchema.safeParse(event.payload);
    if (parsed.success) {
      handler(parsed.data);
    }
  });
}

/** watch-error を購読する。戻り値は購読解除関数。 */
export function onWatchError(
  handler: (event: WatchErrorEvent) => void,
): Promise<UnlistenFn> {
  return listen("watch-error", (event) => {
    const parsed = watchErrorSchema.safeParse(event.payload);
    if (parsed.success) {
      handler(parsed.data);
    }
  });
}

/**
 * ウィンドウへのファイルドラッグ&ドロップを購読する。
 *
 * Tauri v2 の WebView ドラッグ&ドロップイベント（ネイティブ。`dragDropEnabled`
 * 既定 true で OS のファイルパスを取得）を購読する。capability は `core:default`
 * が内包する `core:window`/`core:event` で充足し、追加権限は不要。
 * drop 時のみパスを Zod 検証して渡す。戻り値は購読解除関数。
 */
export function onFileDrop(
  handler: (event: FileDropEvent) => void,
): Promise<UnlistenFn> {
  return getCurrentWebview().onDragDropEvent((event) => {
    const { type } = event.payload;
    if (type === "drop") {
      const parsed = dragDropPayloadSchema.safeParse(event.payload);
      handler({ kind: "drop", paths: parsed.success ? parsed.data.paths : [] });
      return;
    }
    if (type === "enter" || type === "over") {
      handler({ kind: type, paths: [] });
      return;
    }
    handler({ kind: "leave", paths: [] });
  });
}
