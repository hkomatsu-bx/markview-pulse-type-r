import { describe, it, expect, vi, beforeEach } from "vitest";

// Tauri ランタイムを持たない jsdom 上では IPC を呼べないため、
// @tauri-apps/api の invoke / listen をモックして結線の正しさを検証する。
const invokeMock = vi.fn();
const listenMock = vi.fn();
const openPathMock = vi.fn();
const onDragDropEventMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: (...args: unknown[]) => openPathMock(...args),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (...args: unknown[]) => onDragDropEventMock(...args),
  }),
}));

import {
  readMarkdownFile,
  startWatch,
  stopWatch,
  getLaunchFiles,
  getLaunchTheme,
  openInEditor,
  printToPdf,
  onFileChanged,
  onWatchError,
  onOpenFilesPending,
  takePendingOpenFiles,
  onFileDrop,
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
    });

    const result = await readMarkdownFile("a.md");

    expect(invokeMock).toHaveBeenCalledWith("read_markdown_file", {
      path: "a.md",
    });
    expect(result.content).toBe("# x");
  });

  it("printToPdf invokes print_to_pdf with camelCase args including margins", async () => {
    invokeMock.mockResolvedValue(undefined);

    await printToPdf("C:/out/a.pdf", "a", { vertical: 16, horizontal: 14 });

    expect(invokeMock).toHaveBeenCalledWith("print_to_pdf", {
      path: "C:/out/a.pdf",
      headerTitle: "a",
      marginsMm: { vertical: 16, horizontal: 14 },
    });
  });

  it("takePendingOpenFiles drains the forwarded path list", async () => {
    invokeMock.mockResolvedValue(["a.md", "b.markdown"]);

    const result = await takePendingOpenFiles();

    expect(invokeMock).toHaveBeenCalledWith("take_pending_open_files");
    expect(result).toEqual(["a.md", "b.markdown"]);
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
    const onInvalid = vi.fn();

    await onFileChanged(handler, onInvalid);
    captured({ payload: { tabId: "tab-1", path: "a.md" } });

    expect(listenMock).toHaveBeenCalledWith(
      "file-changed",
      expect.any(Function),
    );
    expect(handler).toHaveBeenCalledWith({ tabId: "tab-1", path: "a.md" });
  });

  it("onOpenFilesPending notifies the handler without carrying paths", async () => {
    let captured: (event: { payload: unknown }) => void = () => {};
    listenMock.mockImplementation((_name: string, cb: typeof captured) => {
      captured = cb;
      return Promise.resolve(() => {});
    });
    const handler = vi.fn();

    await onOpenFilesPending(handler);
    captured({ payload: null });

    // パスはイベントに載せず、ハンドラが take_pending_open_files で回収する
    // （購読確立前に届いた転送を取りこぼさないため）。
    expect(listenMock).toHaveBeenCalledWith(
      "open-files-pending",
      expect.any(Function),
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith();
  });

  it("onWatchError forwards the error payload to the handler", async () => {
    let captured: (event: { payload: unknown }) => void = () => {};
    listenMock.mockImplementation((_name: string, cb: typeof captured) => {
      captured = cb;
      return Promise.resolve(() => {});
    });
    const handler = vi.fn();
    const onInvalid = vi.fn();

    await onWatchError(handler, onInvalid);
    captured({ payload: { tabId: "tab-1", message: "boom" } });

    expect(listenMock).toHaveBeenCalledWith(
      "watch-error",
      expect.any(Function),
    );
    expect(handler).toHaveBeenCalledWith({ tabId: "tab-1", message: "boom" });
  });

  it("onFileChanged surfaces an invalid payload instead of dropping it (Zod boundary)", async () => {
    let captured: (event: { payload: unknown }) => void = () => {};
    listenMock.mockImplementation((_name: string, cb: typeof captured) => {
      captured = cb;
      return Promise.resolve(() => {});
    });
    const handler = vi.fn();
    const onInvalid = vi.fn();

    await onFileChanged(handler, onInvalid);
    captured({ payload: { tabId: 123 } });

    expect(handler).not.toHaveBeenCalled();
    // 契約破壊は無音で捨てず、必ず通知経路へ流す（No silent failures）。
    expect(onInvalid).toHaveBeenCalledTimes(1);
    expect(onInvalid.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it("onWatchError surfaces an invalid payload instead of dropping it (Zod boundary)", async () => {
    let captured: (event: { payload: unknown }) => void = () => {};
    listenMock.mockImplementation((_name: string, cb: typeof captured) => {
      captured = cb;
      return Promise.resolve(() => {});
    });
    const handler = vi.fn();
    const onInvalid = vi.fn();

    await onWatchError(handler, onInvalid);
    captured({ payload: { message: null } });

    expect(handler).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledTimes(1);
  });

  it("takePendingOpenFiles rejects a malformed path list (Zod boundary)", async () => {
    // 転送パスの検証はイベントではなく取り出し側（コマンド）の境界で行う。
    invokeMock.mockResolvedValue([1, 2, 3]);

    await expect(takePendingOpenFiles()).rejects.toThrow();
  });
});

describe("fileClient onFileDrop", () => {
  beforeEach(() => {
    onDragDropEventMock.mockReset();
  });

  function captureDrop(): { fire: (payload: unknown) => void } {
    const ref: { fire: (payload: unknown) => void } = { fire: () => {} };
    onDragDropEventMock.mockImplementation(
      (cb: (event: { payload: unknown }) => void) => {
        ref.fire = (payload: unknown) => {
          cb({ payload });
        };
        return Promise.resolve(() => {});
      },
    );
    return ref;
  }

  it("forwards validated paths on a drop event", async () => {
    const ref = captureDrop();
    const handler = vi.fn();
    const onInvalid = vi.fn();

    await onFileDrop(handler, onInvalid);
    ref.fire({ type: "drop", paths: ["a.md", "b.md"] });

    expect(handler).toHaveBeenCalledWith({
      kind: "drop",
      paths: ["a.md", "b.md"],
    });
  });

  it("surfaces a drop payload that fails validation instead of dropping silently", async () => {
    const ref = captureDrop();
    const handler = vi.fn();
    const onInvalid = vi.fn();

    await onFileDrop(handler, onInvalid);
    ref.fire({ type: "drop", paths: [1, 2] });

    // パスを取り出せないドロップは「何も起きない」ため、空配列で握りつぶさない。
    expect(handler).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledTimes(1);
  });

  it("maps enter and over to empty-path events", async () => {
    const ref = captureDrop();
    const handler = vi.fn();
    const onInvalid = vi.fn();

    await onFileDrop(handler, onInvalid);
    ref.fire({ type: "enter", paths: ["ignored"] });
    ref.fire({ type: "over" });

    expect(handler).toHaveBeenNthCalledWith(1, { kind: "enter", paths: [] });
    expect(handler).toHaveBeenNthCalledWith(2, { kind: "over", paths: [] });
  });

  it("maps leave to a leave event", async () => {
    const ref = captureDrop();
    const handler = vi.fn();
    const onInvalid = vi.fn();

    await onFileDrop(handler, onInvalid);
    ref.fire({ type: "leave" });

    expect(handler).toHaveBeenCalledWith({ kind: "leave", paths: [] });
  });
});
