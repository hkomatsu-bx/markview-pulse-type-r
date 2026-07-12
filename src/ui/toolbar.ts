// ツールバー。
//
// 「ファイルを開く」「プレビュー⇄原文」モード切替・「差分強調」トグル・「印刷 / PDF」を配線する。
// 状態は持たず、操作はハンドラへ委譲し、表示反映（setViewModeButtons / setDiffToggle）は
// 呼び出し側が状態に応じて行う。
//
// 差分はモードではなくプレビューに重畳するトグル。ON で previousSource↔source の
// 語差分をプレビューへ強調表示する。原文モードでは無効（disabled）。

import {
  contentWidthLabel,
  type ContentWidth,
} from "../core/view/contentWidth";
import { zoomPercentLabel, type ZoomPercent } from "../core/view/zoomLevel";
import type { ViewMode } from "../core/view/viewMode";
import type { LaunchTheme } from "../types";

export type { ViewMode };

export interface ToolbarElements {
  readonly openFile: HTMLElement;
  readonly modePreview: HTMLElement;
  readonly modeSource: HTMLElement;
  readonly diffToggle: HTMLElement;
  readonly contentWidth: HTMLElement;
  readonly zoom: HTMLElement;
  readonly print: HTMLElement;
  readonly openInEditor: HTMLElement;
  readonly themeLight: HTMLElement;
  readonly themeDark: HTMLElement;
  readonly themeSystem: HTMLElement;
}

export interface ToolbarHandlers {
  readonly onOpenFile: () => void;
  readonly onSelectMode: (mode: ViewMode) => void;
  readonly onToggleDiff: () => void;
  readonly onCycleWidth: () => void;
  readonly onCycleZoom: () => void;
  readonly onPrint: () => void;
  readonly onOpenInEditor: () => void;
  readonly onSelectTheme: (mode: LaunchTheme) => void;
}

/** 表示モードの選択状態を 2 ボタンへ反映する。 */
export function setViewModeButtons(els: ToolbarElements, mode: ViewMode): void {
  const map: readonly (readonly [HTMLElement, ViewMode])[] = [
    [els.modePreview, "preview"],
    [els.modeSource, "source"],
  ];
  for (const [el, m] of map) {
    const active = m === mode;
    el.classList.toggle("is-active", active);
    el.setAttribute("aria-selected", String(active));
  }
}

/**
 * 差分強調トグルの状態を反映する。
 * @param active diffHighlight が ON か（押下状態 aria-pressed）。
 * @param enabled 操作可能か（プレビュー時 true / 原文時 false で disabled）。
 */
export function setDiffToggle(
  els: ToolbarElements,
  state: { readonly active: boolean; readonly enabled: boolean },
): void {
  const { active, enabled } = state;
  els.diffToggle.classList.toggle("is-active", active && enabled);
  els.diffToggle.setAttribute("aria-pressed", String(active));
  els.diffToggle.toggleAttribute("disabled", !enabled);
  els.diffToggle.setAttribute("aria-disabled", String(!enabled));
}

/**
 * 「エディタで開く」の操作可否を反映する。
 * @param enabled アクティブタブがあるか（true で操作可能）。
 */
export function setOpenInEditorEnabled(
  els: ToolbarElements,
  enabled: boolean,
): void {
  els.openInEditor.toggleAttribute("disabled", !enabled);
  els.openInEditor.setAttribute("aria-disabled", String(!enabled));
}

/** コンテンツ幅切替ボタンのラベルを現在値へ反映する。 */
export function setContentWidthLabel(
  els: ToolbarElements,
  width: ContentWidth,
): void {
  const labelEl = els.contentWidth.querySelector(".width-label");
  const text = contentWidthLabel(width);
  if (labelEl instanceof HTMLElement) {
    labelEl.textContent = text;
  } else {
    els.contentWidth.textContent = text;
  }
  els.contentWidth.setAttribute(
    "aria-label",
    `本文幅: ${text}（クリックで切替）`,
  );
}

/** ズーム切替ボタンのラベルを現在値（パーセント）へ反映する。 */
export function setZoomLabel(els: ToolbarElements, percent: ZoomPercent): void {
  const labelEl = els.zoom.querySelector(".zoom-label");
  const text = zoomPercentLabel(percent);
  if (labelEl instanceof HTMLElement) {
    labelEl.textContent = text;
  } else {
    els.zoom.textContent = text;
  }
  els.zoom.setAttribute(
    "aria-label",
    `文字サイズ: ${text}（クリックで拡大・Ctrl+ホイールでも調整）`,
  );
}

/** テーマ選択（ライト/ダーク/システム）の選択状態を 3 ボタンへ反映する。 */
export function setThemeButtons(els: ToolbarElements, mode: LaunchTheme): void {
  const map: readonly (readonly [HTMLElement, LaunchTheme])[] = [
    [els.themeLight, "light"],
    [els.themeDark, "dark"],
    [els.themeSystem, "system"],
  ];
  for (const [el, m] of map) {
    const active = m === mode;
    el.classList.toggle("is-active", active);
    el.setAttribute("aria-selected", String(active));
  }
}

/** ツールバーのクリックを配線する。 */
export function initToolbar(
  els: ToolbarElements,
  handlers: ToolbarHandlers,
): void {
  // 引数なしのハンドラはそのまま委譲（click の Event 引数は無視される）。
  // モード切替のみ固定引数を渡すためラッパが必要。
  els.openFile.addEventListener("click", handlers.onOpenFile);
  els.modePreview.addEventListener("click", () => {
    handlers.onSelectMode("preview");
  });
  els.modeSource.addEventListener("click", () => {
    handlers.onSelectMode("source");
  });
  els.diffToggle.addEventListener("click", handlers.onToggleDiff);
  els.contentWidth.addEventListener("click", handlers.onCycleWidth);
  els.zoom.addEventListener("click", handlers.onCycleZoom);
  els.print.addEventListener("click", handlers.onPrint);
  els.openInEditor.addEventListener("click", handlers.onOpenInEditor);
  els.themeLight.addEventListener("click", () => {
    handlers.onSelectTheme("light");
  });
  els.themeDark.addEventListener("click", () => {
    handlers.onSelectTheme("dark");
  });
  els.themeSystem.addEventListener("click", () => {
    handlers.onSelectTheme("system");
  });
}
