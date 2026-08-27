import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// main.ts（合成ルート）の結線が通ることを確かめるスモークテスト。
// 個々のロジックは各モジュールの単体テストが担うが、「起動して DOM を組み立て、
// 必須要素をすべて見つけ、初期描画まで到達する」経路はここでしか通らない。
// 要素 id の取り違えや結線漏れは型検査では捕まらないため、実際の index.html を
// 読み込んで検証する。

const invoke = vi.fn();
const listen = vi.fn(() => Promise.resolve(() => undefined));
const onDragDropEvent = vi.fn(() => Promise.resolve(() => undefined));
const onThemeChanged = vi.fn(() => Promise.resolve(() => undefined));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => listen() }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => onDragDropEvent() }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    theme: () => Promise.resolve("light"),
    onThemeChanged: () => onThemeChanged(),
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
  message: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));

/** index.html の <body> をそのまま document へ流し込む。 */
function installRealMarkup(): void {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf-8");
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html);
  if (!body?.[1]) {
    throw new Error("index.html の <body> を取り出せませんでした");
  }
  // <script type="module"> は読み込ませない（main.ts は明示的に import する）。
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/g, "");
}

describe("bootstrap（合成ルート）", () => {
  beforeEach(() => {
    // main.ts はモジュール読み込み時に window へ DOMContentLoaded を登録する。
    // resetModules で読み込み直すと登録が積み増され、1 回の dispatch で bootstrap が
    // 複数回走ってしまうため、モジュールは使い回して呼び出し記録だけを消す。
    invoke.mockReset();
    listen.mockClear();
    onDragDropEvent.mockClear();
    onThemeChanged.mockClear();
    // 起動時に呼ばれるコマンドの既定応答。
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "get_launch_theme") return Promise.resolve("system");
      if (cmd === "get_launch_files") return Promise.resolve([]);
      if (cmd === "take_pending_open_files") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    vi.stubGlobal("__APP_VERSION__", "0.0.0-test");
    installRealMarkup();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  /** main.ts を読み込み、DOMContentLoaded を発火して初期化を完了させる。 */
  async function boot(): Promise<void> {
    await import("../../src/main");
    // main.ts は window で待ち受ける。DOMContentLoaded は既定で bubble しないため、
    // document へ流しても window には届かない。
    window.dispatchEvent(new Event("DOMContentLoaded"));
    // 初期化は非同期 IIFE。マイクロタスクを流し切って初期描画まで到達させる。
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_launch_files");
    });
    await Promise.resolve();
  }

  it("実際の index.html に対して必須要素をすべて解決し、初期化が完走する", async () => {
    await boot();

    // requireEl は 1 つでも欠けると throw する。ここまで来ていれば全要素が揃っている。
    expect(invoke).toHaveBeenCalledWith("get_launch_theme");
    expect(invoke).toHaveBeenCalledWith("take_pending_open_files");
  });

  it("タブが無い間は空状態を表示し、タブ依存の操作を無効化する", async () => {
    await boot();

    expect(
      document.getElementById("empty-state")?.classList.contains("hidden"),
    ).toBe(false);
    expect(
      document.getElementById("preview")?.classList.contains("hidden"),
    ).toBe(true);
    expect(document.title).toBe("Markview Pulse Type R");
    for (const id of ["open-in-editor", "save-pdf"]) {
      expect(document.getElementById(id)?.hasAttribute("disabled")).toBe(true);
    }
  });

  it("用紙余白の @page を注入する（PDF 書き出しと同じ値を単一の源から使う）", async () => {
    await boot();

    const style = document.getElementById("page-margin-style");
    expect(style?.textContent).toContain("@page");
    expect(style?.textContent).toContain("16mm 14mm");
  });

  it("空状態で印刷しても WebView の印刷を起動しない", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    await boot();

    document.getElementById("print")?.dispatchEvent(new MouseEvent("click"));
    await Promise.resolve();

    expect(print).not.toHaveBeenCalled();
  });

  it("イベント購読とドラッグ&ドロップ購読を確立する", async () => {
    await boot();

    // file-changed / watch-error / open-files-pending の 3 本。
    expect(listen).toHaveBeenCalledTimes(3);
    expect(onDragDropEvent).toHaveBeenCalledTimes(1);
  });
});
