import { describe, it, expect, beforeEach } from "vitest";
import { renderStatusBar, setStatusNotice } from "../../src/ui/statusBar";
import type { DocumentStats } from "../../src/core/stats/documentStats";

// ステータスバー＋縮退通知。jsdom で描画を検証する。

const STATS: DocumentStats = {
  charCount: 1234,
  lineCount: 56,
  encoding: "UTF-8",
};

const PATH = "C:\\docs\\readme.md";

describe("renderStatusBar", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("footer");
  });

  it("renders the file path on the left and the three stat items", () => {
    renderStatusBar(container, STATS, PATH);

    expect(container.classList.contains("hidden")).toBe(false);
    const path = container.querySelector('[data-testid="status-path"]');
    expect(path?.textContent).toBe(PATH);
    expect(
      container.querySelector('[data-testid="status-char-count"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="status-line-count"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="status-encoding"]'),
    ).not.toBeNull();
  });

  it("sets the full path as the title for hover disclosure of long paths", () => {
    renderStatusBar(container, STATS, PATH);

    const path = container.querySelector('[data-testid="status-path"]');
    expect(path?.getAttribute("title")).toBe(PATH);
  });

  it("places the path before the stats group in DOM order (left vs right)", () => {
    renderStatusBar(container, STATS, PATH);

    // 左（パス）→ 右（統計）の順で配置する。
    const kids = [...container.children];
    const pathIndex = kids.findIndex((k) =>
      k.matches('[data-testid="status-path"]'),
    );
    const statsIndex = kids.findIndex((k) =>
      k.matches('[data-testid="status-stats"]'),
    );
    expect(pathIndex).toBeGreaterThanOrEqual(0);
    expect(pathIndex).toBeLessThan(statsIndex);
  });

  it("omits the path element when filePath is null but keeps stats", () => {
    renderStatusBar(container, STATS, null);

    expect(container.querySelector('[data-testid="status-path"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="status-char-count"]'),
    ).not.toBeNull();
  });

  it("hides and clears when stats are null", () => {
    renderStatusBar(container, STATS, PATH);
    renderStatusBar(container, null, null);

    expect(container.classList.contains("hidden")).toBe(true);
    expect(container.children.length).toBe(0);
  });
});

describe("setStatusNotice（縮退通知）", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("footer");
    renderStatusBar(container, STATS, PATH);
  });

  it("appends a non-modal notice with role=status", () => {
    setStatusNotice(container, "文書が大きいため差分強調を省略しました");

    const notice = container.querySelector('[data-testid="status-notice"]');
    expect(notice?.textContent).toBe("文書が大きいため差分強調を省略しました");
    expect(notice?.getAttribute("role")).toBe("status");
  });

  it("removes the notice when message is null", () => {
    setStatusNotice(container, "通知");
    setStatusNotice(container, null);

    expect(container.querySelector('[data-testid="status-notice"]')).toBeNull();
  });

  it("does not stack duplicate notices on repeated calls", () => {
    setStatusNotice(container, "A");
    setStatusNotice(container, "B");

    const notices = container.querySelectorAll('[data-testid="status-notice"]');
    expect(notices.length).toBe(1);
    expect(notices[0]?.textContent).toBe("B");
  });
});
