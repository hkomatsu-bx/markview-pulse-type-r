import { describe, it, expect } from "vitest";
import {
  createTabState,
  openTab,
  closeTab,
  setActiveTab,
  updateTabSource,
  setTabViewMode,
  getActiveTab,
} from "../../src/core/tabs/tabStore";
import type { Tab } from "../../src/types";

function makeTab(id: string, path: string, source = ""): Tab {
  return {
    id,
    path,
    fileName: path.split(/[/\\]/).pop() ?? path,
    source,
    previousSource: source,
    viewMode: "preview",
    isWatching: false,
  };
}

describe("tabStore", () => {
  it("opens a tab and makes it active", () => {
    const state = openTab(createTabState(), makeTab("1", "/a.md"));
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe("1");
  });

  it("does not duplicate a tab with the same path, just activates it", () => {
    let state = openTab(createTabState(), makeTab("1", "/a.md"));
    state = openTab(state, makeTab("2", "/b.md"));
    state = openTab(state, makeTab("3", "/a.md"));
    expect(state.tabs).toHaveLength(2);
    expect(state.activeTabId).toBe("1");
  });

  it("does not mutate the input state (immutability)", () => {
    const original = openTab(createTabState(), makeTab("1", "/a.md"));
    const snapshot = JSON.stringify(original);
    openTab(original, makeTab("2", "/b.md"));
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("reselects a neighbor when the active tab is closed", () => {
    let state = openTab(createTabState(), makeTab("1", "/a.md"));
    state = openTab(state, makeTab("2", "/b.md"));
    state = setActiveTab(state, "1");
    state = closeTab(state, "1");
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe("2");
  });

  it("sets active to null when the last tab is closed", () => {
    let state = openTab(createTabState(), makeTab("1", "/a.md"));
    state = closeTab(state, "1");
    expect(state.tabs).toHaveLength(0);
    expect(state.activeTabId).toBeNull();
  });

  it("shifts source to previousSource on update (diff baseline)", () => {
    let state = openTab(createTabState(), makeTab("1", "/a.md", "v1"));
    state = updateTabSource(state, "1", "v2");
    const tab = getActiveTab(state);
    expect(tab?.source).toBe("v2");
    expect(tab?.previousSource).toBe("v1");
  });

  it("sets the view mode for a single tab", () => {
    let state = openTab(createTabState(), makeTab("1", "/a.md"));
    state = setTabViewMode(state, "1", "source");
    expect(getActiveTab(state)?.viewMode).toBe("source");
    state = setTabViewMode(state, "1", "preview");
    expect(getActiveTab(state)?.viewMode).toBe("preview");
  });

  it("getActiveTab returns null when no tab matches the active id", () => {
    const state = openTab(createTabState(), makeTab("1", "/a.md"));
    const orphaned = { tabs: state.tabs, activeTabId: "missing" };
    expect(getActiveTab(orphaned)).toBeNull();
  });

  it("closeTab leaves the state unchanged for an unknown id", () => {
    const state = openTab(createTabState(), makeTab("1", "/a.md"));
    expect(closeTab(state, "missing")).toBe(state);
  });

  it("closeTab keeps the active tab when a non-active tab is closed", () => {
    let state = openTab(createTabState(), makeTab("1", "/a.md"));
    state = openTab(state, makeTab("2", "/b.md"));
    state = setActiveTab(state, "1");
    state = closeTab(state, "2");
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe("1");
  });

  it("setActiveTab leaves the state unchanged for an unknown id", () => {
    const state = openTab(createTabState(), makeTab("1", "/a.md"));
    expect(setActiveTab(state, "missing")).toBe(state);
  });

  it("updateTabSource only touches the matching tab", () => {
    let state = openTab(createTabState(), makeTab("1", "/a.md", "a1"));
    state = openTab(state, makeTab("2", "/b.md", "b1"));
    state = updateTabSource(state, "2", "b2");
    const [first, second] = state.tabs;
    expect(first?.source).toBe("a1");
    expect(second?.source).toBe("b2");
    expect(second?.previousSource).toBe("b1");
  });

  it("setTabViewMode only touches the matching tab", () => {
    let state = openTab(createTabState(), makeTab("1", "/a.md"));
    state = openTab(state, makeTab("2", "/b.md"));
    state = setTabViewMode(state, "2", "source");
    const [first, second] = state.tabs;
    expect(first?.viewMode).toBe("preview");
    expect(second?.viewMode).toBe("source");
  });
});
