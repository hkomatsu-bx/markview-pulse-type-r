// タブ状態管理。
//
// すべて不変更新。状態を引数で受け取り、新しい状態を返す純関数の集合。
// id 生成は副作用のため呼び出し側（main.ts）が担う。

import type { Tab, TabId } from "../../types";
import type { ViewMode } from "../view/viewMode";

export interface TabState {
  readonly tabs: readonly Tab[];
  readonly activeTabId: TabId | null;
}

/** 空のタブ状態を生成する。 */
export function createTabState(): TabState {
  return { tabs: [], activeTabId: null };
}

/** アクティブタブを取得する。無ければ null。 */
export function getActiveTab(state: TabState): Tab | null {
  return state.tabs.find((t) => t.id === state.activeTabId) ?? null;
}

/**
 * タブを開く。同一パスのタブが既にあれば複製せずそれをアクティブ化する。
 */
export function openTab(state: TabState, tab: Tab): TabState {
  const existing = state.tabs.find((t) => t.path === tab.path);
  if (existing) {
    return { tabs: state.tabs, activeTabId: existing.id };
  }
  return { tabs: [...state.tabs, tab], activeTabId: tab.id };
}

/**
 * タブを閉じる。閉じたのがアクティブタブなら、隣（右優先、無ければ左）を
 * 新しいアクティブにする。全て閉じたら null。
 */
export function closeTab(state: TabState, id: TabId): TabState {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index === -1) {
    return state;
  }
  const tabs = state.tabs.filter((t) => t.id !== id);
  if (state.activeTabId !== id) {
    return { tabs, activeTabId: state.activeTabId };
  }
  if (tabs.length === 0) {
    return { tabs, activeTabId: null };
  }
  const nextActive = tabs[Math.min(index, tabs.length - 1)];
  return { tabs, activeTabId: nextActive?.id ?? null };
}

/** アクティブタブを切り替える。存在しない id なら無変更。 */
export function setActiveTab(state: TabState, id: TabId): TabState {
  if (!state.tabs.some((t) => t.id === id)) {
    return state;
  }
  return { tabs: state.tabs, activeTabId: id };
}

/**
 * タブのソースを更新する。更新前の source を previousSource へ退避し、
 * 差分の基準にする。
 */
export function updateTabSource(
  state: TabState,
  id: TabId,
  newSource: string,
): TabState {
  return {
    tabs: state.tabs.map((t) =>
      t.id === id ? { ...t, previousSource: t.source, source: newSource } : t,
    ),
    activeTabId: state.activeTabId,
  };
}

/** タブの表示モードを設定する（プレビュー/原文/差分の排他切替）。 */
export function setTabViewMode(
  state: TabState,
  id: TabId,
  viewMode: ViewMode,
): TabState {
  return {
    tabs: state.tabs.map((t) => (t.id === id ? { ...t, viewMode } : t)),
    activeTabId: state.activeTabId,
  };
}
