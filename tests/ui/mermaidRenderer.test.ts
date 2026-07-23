import { describe, it, expect, afterEach, vi } from "vitest";
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
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("uses securityLevel strict in light theme", () => {
    document.documentElement.setAttribute("data-theme", "light");
    expect(buildMermaidConfig().securityLevel).toBe("strict");
  });

  it("uses securityLevel strict in dark theme", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    expect(buildMermaidConfig().securityLevel).toBe("strict");
  });

  it("uses securityLevel strict when no theme is set", () => {
    expect(buildMermaidConfig().securityLevel).toBe("strict");
  });

  it("never enables startOnLoad (renders explicitly via run)", () => {
    expect(buildMermaidConfig().startOnLoad).toBe(false);
  });

  it("uses the base theme with custom variables in dark for contrast", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    const config = buildMermaidConfig();
    expect(config.theme).toBe("base");
    expect(config.themeVariables).toMatchObject({ darkMode: true });
  });

  it("uses the default theme in light", () => {
    document.documentElement.setAttribute("data-theme", "light");
    expect(buildMermaidConfig().theme).toBe("default");
  });
});

describe("renderMermaid", () => {
  it("does not import mermaid when there are no mermaid blocks", async () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>no diagrams here</p>";
    const onError = vi.fn();
    await renderMermaid(container, () => true, onError);
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
    );

    expect(mermaid.initialize).toHaveBeenCalled();
    expect(mermaid.run).toHaveBeenCalled();
  });

  it("aborts without touching the DOM when the generation is stale", async () => {
    const container = document.createElement("div");
    container.innerHTML = '<pre class="mermaid">graph TD\nA-->B</pre>';
    const onError = vi.fn();
    // isCurrent が false（古い世代）なら描画せず、エラーも出さない。
    await renderMermaid(container, () => false, onError);
    expect(onError).not.toHaveBeenCalled();
    expect(container.querySelector("pre.mermaid")).not.toBeNull();
  });
});
