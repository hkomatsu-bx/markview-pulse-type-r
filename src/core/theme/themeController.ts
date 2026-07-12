// テーマ制御。
//
// CSS は :root:not([data-theme]) + prefers-color-scheme で OS 追従するが、
// WebView の環境差を吸収するため Tauri のテーマ変更も購読し data-theme を明示同期する。
// Tauri 依存は ThemeSource として注入し、本モジュールは DOM 操作のみに留めて単体試験可能にする。

import type { AppTheme, LaunchTheme } from "../../types";

/** ルート要素へテーマを適用する（data-theme 属性方式、styles.css と対応）。 */
export function applyTheme(root: HTMLElement, theme: AppTheme): void {
  root.setAttribute("data-theme", theme);
}

/** OS テーマの取得元。main.ts が Tauri のウィンドウ API から実装を組み立てる。 */
export interface ThemeSource {
  /** 現在の OS / ウィンドウテーマ。 */
  current(): Promise<AppTheme>;
  /** テーマ変更を購読する。戻り値は購読解除関数。 */
  onChange(handler: (theme: AppTheme) => void): Promise<() => void>;
}

/**
 * OS テーマに追従する。初期テーマを適用し、以後の変更で再適用する。
 * @returns 購読解除関数。
 */
export async function followOsTheme(
  root: HTMLElement,
  source: ThemeSource,
): Promise<() => void> {
  applyTheme(root, await source.current());
  return source.onChange((theme) => {
    applyTheme(root, theme);
  });
}

/**
 * 起動引数のテーマ指定を適用する。
 * - `"dark"` / `"light"`: 固定適用し、OS テーマ変更を購読しない（追従しない）。
 * - `"system"`: OS テーマへ追従する。
 *
 * @returns 購読解除関数。固定テーマ時は no-op（購読していないため）。
 */
export async function applyLaunchTheme(
  root: HTMLElement,
  launchTheme: LaunchTheme,
  source: ThemeSource,
): Promise<() => void> {
  if (launchTheme === "system") {
    return followOsTheme(root, source);
  }
  applyTheme(root, launchTheme);
  return () => {
    // 固定テーマでは OS 追従を購読しないため、解除は何もしない。
  };
}

/** 実行時にテーマモード（light/dark/system）を切り替えられるコントローラ。 */
export interface ThemeController {
  /** 現在のモード。 */
  getMode(): LaunchTheme;
  /** モードを切り替える。system は OS 追従、light/dark は固定適用。 */
  setMode(mode: LaunchTheme): Promise<void>;
  /** OS 追従中の購読を解除する。 */
  dispose(): void;
}

/**
 * テーマモードを実行時に切り替えるコントローラを生成する。
 *
 * モード切替のたびに直前の購読（system 時のみ存在）を解除してから再適用するため、
 * OS 追従リスナが多重登録されない。初期モードは起動引数から渡す。
 */
export async function createThemeController(
  root: HTMLElement,
  source: ThemeSource,
  initialMode: LaunchTheme,
): Promise<ThemeController> {
  let mode = initialMode;
  let dispose = await applyLaunchTheme(root, mode, source);

  return {
    getMode: () => mode,
    async setMode(next: LaunchTheme): Promise<void> {
      if (next === mode) {
        return;
      }
      dispose(); // 既存購読（system 時）を解除してから切替
      mode = next;
      dispose = await applyLaunchTheme(root, mode, source);
    },
    dispose: () => {
      dispose();
    },
  };
}
