// タブバー描画。
//
// TabState を受け取り、タブ要素を描画する純レンダラ。状態は持たず、
// クリック（選択）・閉じる操作はハンドラへ委譲する（状態更新は呼び出し側）。

import type { TabState } from "../core/tabs/tabStore";
import type { TabId } from "../types";

export interface TabBarHandlers {
  readonly onSelect: (id: TabId) => void;
  readonly onClose: (id: TabId) => void;
}

/** タブバーを描画する。既存内容は置き換える。 */
export function renderTabBar(
  container: HTMLElement,
  state: TabState,
  handlers: TabBarHandlers,
): void {
  const doc = container.ownerDocument;

  const elements = state.tabs.map((tab) => {
    const isActive = tab.id === state.activeTabId;

    const tabEl = doc.createElement("div");
    tabEl.className = isActive ? "tab is-active" : "tab";
    tabEl.dataset.tabId = tab.id;
    tabEl.setAttribute("role", "tab");
    tabEl.setAttribute("aria-selected", String(isActive));
    // 選択はタブ全体で受ける（ラベル文字以外の余白クリックでも切替可能にする）。
    tabEl.addEventListener("click", () => {
      handlers.onSelect(tab.id);
    });

    const label = doc.createElement("span");
    label.className = "tab-name";
    label.textContent = tab.fileName;
    label.title = tab.path;

    const closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "tab-close";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", `${tab.fileName} を閉じる`);
    closeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      handlers.onClose(tab.id);
    });

    tabEl.append(label, closeBtn);
    return tabEl;
  });

  container.replaceChildren(...elements);
}
