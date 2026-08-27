import { describe, it, expect, vi } from "vitest";
import {
  buildMermaidConfig,
  renderMermaid,
} from "../../src/ui/mermaidRenderer";

// mermaid の遅延 import をスタブ化し、実バンドルを読み込まずに描画経路を検証する。
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    run: vi.fn().mockResolvedValue(undefined),
  },
}));

// mermaid は未信頼の .md 由来の図ソースを処理する。securityLevel を "strict" 以外へ
// 緩めると SVG へのスクリプト注入・click コールバックが有効化されるため、
// どのテーマでも "strict" 固定であることを回帰テストで担保する。
describe("buildMermaidConfig", () => {
  it("uses securityLevel strict in light theme", () => {
    expect(buildMermaidConfig("light").securityLevel).toBe("strict");
  });

  it("uses securityLevel strict in dark theme", () => {
    expect(buildMermaidConfig("dark").securityLevel).toBe("strict");
  });

  it("never enables startOnLoad (renders explicitly via run)", () => {
    expect(buildMermaidConfig("light").startOnLoad).toBe(false);
  });

  it("uses the base theme with custom variables in dark for contrast", () => {
    const config = buildMermaidConfig("dark");
    expect(config.theme).toBe("base");
    expect(config.themeVariables).toMatchObject({ darkMode: true });
  });

  it("uses the default theme in light", () => {
    expect(buildMermaidConfig("light").theme).toBe("default");
  });

  // 画面がダークでも PDF はライトで出す。DOM を読まず引数で決まることを担保する。
  it("ignores the document theme attribute and honors the argument", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    try {
      expect(buildMermaidConfig("light").theme).toBe("default");
    } finally {
      document.documentElement.removeAttribute("data-theme");
    }
  });

  // htmlLabels:true（既定）だとラベルが <foreignObject><div> で描かれ、
  // sanitizeMermaidSvg の SVG-only allowlist が中身ごと除去してしまい、
  // ボックスは残るが文字列だけ消える。純 SVG の <text> に倒すことで防ぐ。
  it("disables htmlLabels so labels render as plain SVG text", () => {
    expect(buildMermaidConfig("light").htmlLabels).toBe(false);
    expect(buildMermaidConfig("dark").htmlLabels).toBe(false);
  });
});

describe("renderMermaid", () => {
  it("does not import mermaid when there are no mermaid blocks", async () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>no diagrams here</p>";
    const onError = vi.fn();
    await renderMermaid(container, () => true, onError, "light");
    expect(onError).not.toHaveBeenCalled();
  });

  it("initializes and runs mermaid on the current-generation nodes", async () => {
    const mermaid = (await import("mermaid")).default;
    const container = document.createElement("div");
    container.innerHTML = '<pre class="mermaid">graph TD\nA-->B</pre>';

    await renderMermaid(
      container,
      () => true,
      () => undefined,
      "light",
    );

    expect(mermaid.initialize).toHaveBeenCalled();
    expect(mermaid.run).toHaveBeenCalled();
  });

  it("aborts without touching the DOM when the generation is stale", async () => {
    const container = document.createElement("div");
    container.innerHTML = '<pre class="mermaid">graph TD\nA-->B</pre>';
    const onError = vi.fn();
    // isCurrent が false（古い世代）なら描画せず、エラーも出さない。
    await renderMermaid(container, () => false, onError, "light");
    expect(onError).not.toHaveBeenCalled();
    expect(container.querySelector("pre.mermaid")).not.toBeNull();
  });
});
