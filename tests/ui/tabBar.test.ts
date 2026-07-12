import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderTabBar } from "../../src/ui/tabBar";
import type { TabState } from "../../src/core/tabs/tabStore";
import type { Tab } from "../../src/types";

// タブバーは TabState を受ける純レンダラ。jsdom で描画と操作配線を検証する。

function makeTab(id: string, fileName: string): Tab {
  return {
    id,
    path: `C:/docs/${fileName}`,
    fileName,
    source: "",
    previousSource: "",
    viewMode: "preview",
    isWatching: false,
  };
}

describe("renderTabBar", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("nav");
  });

  it("renders one element per tab and marks the active tab", () => {
    const state: TabState = {
      tabs: [makeTab("t1", "a.md"), makeTab("t2", "b.md")],
      activeTabId: "t2",
    };

    renderTabBar(container, state, { onSelect: vi.fn(), onClose: vi.fn() });

    const tabs = container.querySelectorAll(".tab");
    expect(tabs.length).toBe(2);
    expect(tabs[1]!.classList.contains("is-active")).toBe(true);
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("calls onSelect with the tab id when the label is clicked", () => {
    const onSelect = vi.fn();
    const state: TabState = {
      tabs: [makeTab("t1", "a.md")],
      activeTabId: "t1",
    };
    renderTabBar(container, state, { onSelect, onClose: vi.fn() });

    container.querySelector<HTMLElement>(".tab-name")?.click();

    expect(onSelect).toHaveBeenCalledWith("t1");
  });

  it("calls onSelect when the tab body (not just the label) is clicked", () => {
    const onSelect = vi.fn();
    const state: TabState = {
      tabs: [makeTab("t1", "a.md")],
      activeTabId: "t1",
    };
    renderTabBar(container, state, { onSelect, onClose: vi.fn() });

    container.querySelector<HTMLElement>(".tab")?.click();

    expect(onSelect).toHaveBeenCalledWith("t1");
  });

  it("calls onClose (not onSelect) when the close button is clicked", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const state: TabState = {
      tabs: [makeTab("t1", "a.md")],
      activeTabId: "t1",
    };
    renderTabBar(container, state, { onSelect, onClose });

    container.querySelector<HTMLElement>(".tab-close")?.click();

    expect(onClose).toHaveBeenCalledWith("t1");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("replaces previous content on re-render", () => {
    const state1: TabState = {
      tabs: [makeTab("t1", "a.md")],
      activeTabId: "t1",
    };
    const state2: TabState = {
      tabs: [makeTab("t2", "b.md")],
      activeTabId: "t2",
    };
    renderTabBar(container, state1, { onSelect: vi.fn(), onClose: vi.fn() });

    renderTabBar(container, state2, { onSelect: vi.fn(), onClose: vi.fn() });

    expect(container.querySelectorAll(".tab").length).toBe(1);
    expect(container.querySelector(".tab-name")?.textContent).toBe("b.md");
  });
});
