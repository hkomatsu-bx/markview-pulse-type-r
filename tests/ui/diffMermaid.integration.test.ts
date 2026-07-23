import { describe, it, expect, vi } from "vitest";
import { renderMarkdown } from "../../src/core/markdown";
import { renderDiff } from "../../src/core/diff/diffDom";
import { renderMermaid } from "../../src/ui/mermaidRenderer";

// mermaid の遅延 import をスタブ化し、実バンドルを読み込まずに描画経路（run に渡る
// ノードと図ソース）を検証する。mermaidRenderer.test.ts と同じ方針。
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    run: vi.fn().mockResolvedValue(undefined),
  },
}));

// #18: 差分強調 ON × mermaid の結合。main.ts の差分パス
// （renderDiff → pre.mermaid 検出 → renderMermaid）を再現し、
// 図が原文どおり mermaid.run へ渡ることを担保する。
describe("diff × mermaid 結合（#18）", () => {
  it("本文だけ変わり図は不変のとき、差分 DOM 上で mermaid を原文どおり描画する", async () => {
    const prev =
      "# Title\n\nold prose here.\n\n```mermaid\ngraph TD\nA-->B\n```\n";
    const next =
      "# Title\n\nnew prose here.\n\n```mermaid\ngraph TD\nA-->B\n```\n";
    const container = document.createElement("div");
    container.className = "markdown-body";

    const { degraded } = renderDiff(
      container,
      renderMarkdown(prev),
      renderMarkdown(next),
    );
    expect(degraded).toBe(false);

    const pre = container.querySelector<HTMLElement>("pre.mermaid");
    expect(pre).not.toBeNull();
    // ブロック内に差分 span が注入されていない（従来はここが壊れていた）。
    expect(pre?.querySelector(".diff-added, .diff-removed")).toBeNull();
    // mermaid が読む textContent が原文どおり。
    expect(pre?.textContent).toContain("graph TD");
    expect(pre?.textContent).toContain("A-->B");

    // main.ts 相当: renderPreview 直後に pre.mermaid を検出できる。
    expect(container.querySelector("pre.mermaid")).not.toBeNull();

    const mermaid = (await import("mermaid")).default;
    const onError = vi.fn();
    await renderMermaid(container, () => true, onError);

    expect(onError).not.toHaveBeenCalled();
    expect(mermaid.run).toHaveBeenCalledTimes(1);
    const runArg = vi.mocked(mermaid.run).mock.calls[0]?.[0];
    expect(runArg?.nodes).toContain(pre);
  });

  it("図ソース自体が変わっても、次版の図が span なしで描画される", async () => {
    const prev = "```mermaid\ngraph TD\nA-->B\n```\n";
    const next = "```mermaid\ngraph TD\nA-->C\n```\n";
    const container = document.createElement("div");
    container.className = "markdown-body";

    renderDiff(container, renderMarkdown(prev), renderMarkdown(next));

    const pre = container.querySelector<HTMLElement>("pre.mermaid");
    expect(pre?.querySelector(".diff-added, .diff-removed")).toBeNull();
    expect(pre?.textContent).toContain("A-->C");

    const mermaid = (await import("mermaid")).default;
    await renderMermaid(container, () => true, vi.fn());
    expect(mermaid.run).toHaveBeenCalled();
  });
});
