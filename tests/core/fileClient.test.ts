import { describe, it, expect, vi, beforeEach } from "vitest";

// Tauri ランタイムを持たない jsdom 上では IPC を呼べないため、
// @tauri-apps/api の invoke / listen をモックして結線の正しさを検証する。
const invokeMock = vi.fn();
const listenMock = vi.fn();
const openPathMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: (...args: unknown[]) => openPathMock(...args),
}));

import {
  readMarkdownFile,
  startWatch,
  stopWatch,
  getLaunchFiles,
  getLaunchTheme,
  openInEditor,
  onFileChanged,
  onWatchError,
  onOpenFiles,
} from "../../src/core/fs/fileClient";

describe("fileClient IPC wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it("readMarkdownFile invokes read_markdown_file with the path", async () => {
    invokeMock.mockResolvedValue({
      path: "a.md",
      content: "# x",
      modifiedMs: 1,
    });

    const result = await readMarkdownFile("a.md");

    expect(invokeMock).toHaveBeenCalledWith("read_markdown_file", {
      path: "a.md",
    });
    expect(result.content).toBe("# x");
  });

  it("startWatch invokes start_watch with camelCase tabId/path", async () => {
    invokeMock.mockResolvedValue(undefined);

    await startWatch("tab-1", "a.md");

    expect(invokeMock).toHaveBeenCalledWith("start_watch", {
      tabId: "tab-1",
      path: "a.md",
    });
  });

  it("stopWatch invokes stop_watch with tabId", async () => {
    invokeMock.mockResolvedValue(undefined);

    await stopWatch("tab-1");

    expect(invokeMock).toHaveBeenCalledWith("stop_watch", { tabId: "tab-1" });
  });

  it("getLaunchFiles invokes get_launch_files and returns the list", async () => {
    invokeMock.mockResolvedValue(["a.md", "b.md"]);

    const result = await getLaunchFiles();

    expect(invokeMock).toHaveBeenCalledWith("get_launch_files");
    expect(result).toEqual(["a.md", "b.md"]);
  });

  it("getLaunchTheme returns a valid theme as-is (FR-20)", async () => {
    invokeMock.mockResolvedValue("dark");

    const result = await getLaunchTheme();

    expect(invokeMock).toHaveBeenCalledWith("get_launch_theme");
    expect(result).toBe("dark");
  });

  it('getLaunchTheme normalizes an invalid value to "system" (FR-20)', async () => {
    invokeMock.mockResolvedValue("chartreuse");

    const result = await getLaunchTheme();

    expect(result).toBe("system");
  });

  it("openInEditor delegates to the opener plugin with the path (FR-19)", async () => {
    openPathMock.mockResolvedValue(undefined);

    await openInEditor("C:/docs/a.md");

    expect(openPathMock).toHaveBeenCalledWith("C:/docs/a.md");
  });
});

describe("fileClient event subscriptions", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it("onFileChanged forwards the event payload to the handler", async () => {
    let captured: (event: { payload: unknown }) => void = () => {};
    listenMock.mockImplementation((_name: string, cb: typeof captured) => {
      captured = cb;
      return Promise.resolve(() => {});
    });
    const handler = vi.fn();

    await onFileChanged(handler);
    captured({ payload: { tabId: "tab-1", path: "a.md" } });

    expect(listenMock).toHaveBeenCalledWith(
      "file-changed",
      expect.any(Function),
    );
    expect(handler).toHaveBeenCalledWith({ tabId: "tab-1", path: "a.md" });
  });

  it("onOpenFiles forwards the validated path list to the handler", async () => {
    let captured: (event: { payload: unknown }) => void = () => {};
    listenMock.mockImplementation((_name: string, cb: typeof captured) => {
      captured = cb;
      return Promise.resolve(() => {});
    });
    const handler = vi.fn();

    await onOpenFiles(handler);
    captured({ payload: ["a.md", "b.markdown"] });

    expect(listenMock).toHaveBeenCalledWith("open-files", expect.any(Function));
    expect(handler).toHaveBeenCalledWith(["a.md", "b.markdown"]);
  });

  it("onWatchError forwards the error payload to the handler", async () => {
    let captured: (event: { payload: unknown }) => void = () => {};
    listenMock.mockImplementation((_name: string, cb: typeof captured) => {
      captured = cb;
      return Promise.resolve(() => {});
    });
    const handler = vi.fn();

    await onWatchError(handler);
    captured({ payload: { tabId: "tab-1", message: "boom" } });

    expect(listenMock).toHaveBeenCalledWith(
      "watch-error",
      expect.any(Function),
    );
    expect(handler).toHaveBeenCalledWith({ tabId: "tab-1", message: "boom" });
  });
});
