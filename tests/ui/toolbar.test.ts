import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  initToolbar,
  setViewModeButtons,
  setDiffToggle,
  setContentWidthLabel,
  setZoomLabel,
  setOpenInEditorEnabled,
  setThemeButtons,
} from "../../src/ui/toolbar";
import type { ToolbarElements, ToolbarHandlers } from "../../src/ui/toolbar";

// ツールバー：ファイルを開く／表示モード（プレビュー/原文）／差分強調トグル／
// 本文幅切替。状態反映（setViewModeButtons / setDiffToggle / setContentWidthLabel）と
// 配線（initToolbar）を分離して検証する。

function makeElements(): ToolbarElements {
  const contentWidth = document.createElement("button");
  const label = document.createElement("span");
  label.className = "width-label";
  contentWidth.appendChild(label);
  const zoom = document.createElement("button");
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "zoom-label";
  zoom.appendChild(zoomLabel);
  return {
    openFile: document.createElement("button"),
    modePreview: document.createElement("button"),
    modeSource: document.createElement("button"),
    diffToggle: document.createElement("button"),
    contentWidth,
    zoom,
    print: document.createElement("button"),
    openInEditor: document.createElement("button"),
    themeLight: document.createElement("button"),
    themeDark: document.createElement("button"),
    themeSystem: document.createElement("button"),
  };
}

/** 全ハンドラを vi.fn() で満たした既定値（テストで一部だけ差し替える）。 */
function makeHandlers(
  overrides: Partial<ToolbarHandlers> = {},
): ToolbarHandlers {
  return {
    onOpenFile: vi.fn(),
    onSelectMode: vi.fn(),
    onToggleDiff: vi.fn(),
    onCycleWidth: vi.fn(),
    onCycleZoom: vi.fn(),
    onPrint: vi.fn(),
    onOpenInEditor: vi.fn(),
    onSelectTheme: vi.fn(),
    ...overrides,
  };
}

describe("setViewModeButtons（FR-17）", () => {
  let els: ToolbarElements;

  beforeEach(() => {
    els = makeElements();
  });

  it("marks only the active mode and updates aria-selected", () => {
    setViewModeButtons(els, "source");

    expect(els.modeSource.classList.contains("is-active")).toBe(true);
    expect(els.modePreview.classList.contains("is-active")).toBe(false);
    expect(els.modeSource.getAttribute("aria-selected")).toBe("true");
    expect(els.modePreview.getAttribute("aria-selected")).toBe("false");
  });

  it("switches the active mode exclusively", () => {
    setViewModeButtons(els, "preview");

    expect(els.modePreview.classList.contains("is-active")).toBe(true);
    expect(els.modeSource.classList.contains("is-active")).toBe(false);
  });
});

describe("setDiffToggle（FR-03）", () => {
  let els: ToolbarElements;

  beforeEach(() => {
    els = makeElements();
  });

  it("reflects ON state as pressed and active when enabled", () => {
    setDiffToggle(els, { active: true, enabled: true });

    expect(els.diffToggle.getAttribute("aria-pressed")).toBe("true");
    expect(els.diffToggle.classList.contains("is-active")).toBe(true);
    expect(els.diffToggle.hasAttribute("disabled")).toBe(false);
  });

  it("disables the toggle in source mode (enabled=false)", () => {
    setDiffToggle(els, { active: true, enabled: false });

    expect(els.diffToggle.hasAttribute("disabled")).toBe(true);
    expect(els.diffToggle.getAttribute("aria-disabled")).toBe("true");
    // 無効時は active クラスを付けない（押下状態を視覚的に誤認させない）。
    expect(els.diffToggle.classList.contains("is-active")).toBe(false);
  });

  it("reflects OFF state", () => {
    setDiffToggle(els, { active: false, enabled: true });

    expect(els.diffToggle.getAttribute("aria-pressed")).toBe("false");
    expect(els.diffToggle.classList.contains("is-active")).toBe(false);
  });
});

describe("initToolbar", () => {
  let els: ToolbarElements;

  beforeEach(() => {
    els = makeElements();
  });

  it("invokes onOpenFile when the open button is clicked", () => {
    const onOpenFile = vi.fn();
    initToolbar(els, makeHandlers({ onOpenFile }));

    els.openFile.click();

    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });

  it("invokes onSelectMode with the chosen mode", () => {
    const onSelectMode = vi.fn();
    initToolbar(els, makeHandlers({ onSelectMode }));

    els.modePreview.click();
    els.modeSource.click();

    expect(onSelectMode).toHaveBeenNthCalledWith(1, "preview");
    expect(onSelectMode).toHaveBeenNthCalledWith(2, "source");
  });

  it("invokes onToggleDiff when the diff toggle is clicked", () => {
    const onToggleDiff = vi.fn();
    initToolbar(els, makeHandlers({ onToggleDiff }));

    els.diffToggle.click();

    expect(onToggleDiff).toHaveBeenCalledTimes(1);
  });

  it("invokes onCycleWidth when the width button is clicked", () => {
    const onCycleWidth = vi.fn();
    initToolbar(els, makeHandlers({ onCycleWidth }));

    els.contentWidth.click();

    expect(onCycleWidth).toHaveBeenCalledTimes(1);
  });

  it("invokes onCycleZoom when the zoom button is clicked", () => {
    const onCycleZoom = vi.fn();
    initToolbar(els, makeHandlers({ onCycleZoom }));

    els.zoom.click();

    expect(onCycleZoom).toHaveBeenCalledTimes(1);
  });

  it("invokes onSelectTheme with the chosen mode", () => {
    const onSelectTheme = vi.fn();
    initToolbar(els, makeHandlers({ onSelectTheme }));

    els.themeLight.click();
    els.themeDark.click();
    els.themeSystem.click();

    expect(onSelectTheme).toHaveBeenNthCalledWith(1, "light");
    expect(onSelectTheme).toHaveBeenNthCalledWith(2, "dark");
    expect(onSelectTheme).toHaveBeenNthCalledWith(3, "system");
  });

  it("invokes onPrint when the print button is clicked", () => {
    const onPrint = vi.fn();
    initToolbar(els, makeHandlers({ onPrint }));

    els.print.click();

    expect(onPrint).toHaveBeenCalledTimes(1);
  });

  it("invokes onOpenInEditor when the editor button is clicked (FR-19)", () => {
    const onOpenInEditor = vi.fn();
    initToolbar(els, makeHandlers({ onOpenInEditor }));

    els.openInEditor.click();

    expect(onOpenInEditor).toHaveBeenCalledTimes(1);
  });
});

describe("setOpenInEditorEnabled（FR-19）", () => {
  it("enables the button when a tab is active", () => {
    const els = makeElements();
    els.openInEditor.setAttribute("disabled", "");

    setOpenInEditorEnabled(els, true);

    expect(els.openInEditor.hasAttribute("disabled")).toBe(false);
    expect(els.openInEditor.getAttribute("aria-disabled")).toBe("false");
  });

  it("disables the button when no tab is active", () => {
    const els = makeElements();

    setOpenInEditorEnabled(els, false);

    expect(els.openInEditor.hasAttribute("disabled")).toBe(true);
    expect(els.openInEditor.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("setContentWidthLabel（FR-12）", () => {
  it("ラベル要素に日本語ラベルを反映し aria-label を更新する", () => {
    const els = makeElements();

    setContentWidthLabel(els, "wide");

    const label = els.contentWidth.querySelector(".width-label");
    expect(label?.textContent).toBe("広");
    expect(els.contentWidth.getAttribute("aria-label")).toContain("広");
  });
});

describe("setThemeButtons", () => {
  it("marks only the active theme and updates aria-selected", () => {
    const els = makeElements();

    setThemeButtons(els, "dark");

    expect(els.themeDark.classList.contains("is-active")).toBe(true);
    expect(els.themeLight.classList.contains("is-active")).toBe(false);
    expect(els.themeSystem.classList.contains("is-active")).toBe(false);
    expect(els.themeDark.getAttribute("aria-selected")).toBe("true");
    expect(els.themeSystem.getAttribute("aria-selected")).toBe("false");
  });

  it("switches the active theme exclusively to system", () => {
    const els = makeElements();
    setThemeButtons(els, "dark");

    setThemeButtons(els, "system");

    expect(els.themeSystem.classList.contains("is-active")).toBe(true);
    expect(els.themeDark.classList.contains("is-active")).toBe(false);
  });
});

describe("setZoomLabel", () => {
  it("ラベル要素にパーセントを反映し aria-label を更新する", () => {
    const els = makeElements();

    setZoomLabel(els, 150);

    const label = els.zoom.querySelector(".zoom-label");
    expect(label?.textContent).toBe("150%");
    expect(els.zoom.getAttribute("aria-label")).toContain("150%");
  });
});
