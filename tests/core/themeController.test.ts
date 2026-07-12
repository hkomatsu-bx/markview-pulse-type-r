import { describe, it, expect, vi } from "vitest";
import {
  applyTheme,
  followOsTheme,
  applyLaunchTheme,
  createThemeController,
} from "../../src/core/theme/themeController";
import type { AppTheme } from "../../src/types";

// OS テーマ追従は CSS の prefers-color-scheme が担うが、
// 確実性のため Tauri のテーマ変更も購読して data-theme を明示同期する。
// themeController は注入された ThemeSource に依存し、Tauri 非依存で単体試験できる。

describe("applyTheme", () => {
  it("sets data-theme attribute to the given theme", () => {
    const root = document.createElement("html");

    applyTheme(root, "dark");

    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("overwrites a previous theme", () => {
    const root = document.createElement("html");
    applyTheme(root, "dark");

    applyTheme(root, "light");

    expect(root.getAttribute("data-theme")).toBe("light");
  });
});

describe("followOsTheme", () => {
  it("applies the current OS theme on init", async () => {
    const root = document.createElement("html");
    const source = {
      current: () => Promise.resolve<AppTheme>("dark"),
      onChange: () => Promise.resolve(() => {}),
    };

    await followOsTheme(root, source);

    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("re-applies the theme when the OS theme changes", async () => {
    const root = document.createElement("html");
    let emit: (theme: AppTheme) => void = () => {};
    const source = {
      current: () => Promise.resolve<AppTheme>("light"),
      onChange: (handler: (theme: AppTheme) => void) => {
        emit = handler;
        return Promise.resolve(() => {});
      },
    };

    await followOsTheme(root, source);
    emit("dark");

    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("returns the unsubscribe function from the source", async () => {
    const root = document.createElement("html");
    const unlisten = vi.fn();
    const source = {
      current: () => Promise.resolve<AppTheme>("light"),
      onChange: () => Promise.resolve(unlisten),
    };

    const dispose = await followOsTheme(root, source);
    dispose();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});

describe("applyLaunchTheme (FR-20)", () => {
  it("applies a fixed dark theme and does NOT subscribe to OS changes", async () => {
    const root = document.createElement("html");
    const onChange = vi.fn(() => Promise.resolve(() => {}));
    const source = {
      current: () => Promise.resolve<AppTheme>("light"),
      onChange,
    };

    await applyLaunchTheme(root, "dark", source);

    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("applies a fixed light theme regardless of OS current theme", async () => {
    const root = document.createElement("html");
    const source = {
      current: () => Promise.resolve<AppTheme>("dark"),
      onChange: () => Promise.resolve(() => {}),
    };

    await applyLaunchTheme(root, "light", source);

    expect(root.getAttribute("data-theme")).toBe("light");
  });

  it('follows the OS theme when launch theme is "system"', async () => {
    const root = document.createElement("html");
    let emit: (theme: AppTheme) => void = () => {};
    const source = {
      current: () => Promise.resolve<AppTheme>("light"),
      onChange: (handler: (theme: AppTheme) => void) => {
        emit = handler;
        return Promise.resolve(() => {});
      },
    };

    await applyLaunchTheme(root, "system", source);
    expect(root.getAttribute("data-theme")).toBe("light");
    emit("dark");
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("returns a no-op disposer for a fixed theme", async () => {
    const root = document.createElement("html");
    const unlisten = vi.fn();
    const source = {
      current: () => Promise.resolve<AppTheme>("light"),
      onChange: () => Promise.resolve(unlisten),
    };

    const dispose = await applyLaunchTheme(root, "dark", source);
    dispose();

    // 固定テーマでは購読していないので、解除関数は何も呼ばない。
    expect(unlisten).not.toHaveBeenCalled();
  });
});

describe("createThemeController", () => {
  it("applies the initial mode and reports it via getMode", async () => {
    const root = document.createElement("html");
    const source = {
      current: () => Promise.resolve<AppTheme>("light"),
      onChange: () => Promise.resolve(() => {}),
    };

    const controller = await createThemeController(root, source, "dark");

    expect(controller.getMode()).toBe("dark");
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("switches from a fixed theme to OS-following system mode", async () => {
    const root = document.createElement("html");
    let emit: (theme: AppTheme) => void = () => {};
    const source = {
      current: () => Promise.resolve<AppTheme>("light"),
      onChange: (handler: (theme: AppTheme) => void) => {
        emit = handler;
        return Promise.resolve(() => {});
      },
    };

    const controller = await createThemeController(root, source, "dark");
    await controller.setMode("system");

    expect(controller.getMode()).toBe("system");
    expect(root.getAttribute("data-theme")).toBe("light");
    // system モードでは以後の OS 変更へ追従する。
    emit("dark");
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("unsubscribes the previous OS listener when leaving system mode", async () => {
    const root = document.createElement("html");
    const unlisten = vi.fn();
    const source = {
      current: () => Promise.resolve<AppTheme>("light"),
      onChange: () => Promise.resolve(unlisten),
    };

    const controller = await createThemeController(root, source, "system");
    await controller.setMode("dark");

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("is a no-op when setting the same mode (no duplicate subscriptions)", async () => {
    const root = document.createElement("html");
    const onChange = vi.fn(() => Promise.resolve(() => {}));
    const source = {
      current: () => Promise.resolve<AppTheme>("light"),
      onChange,
    };

    const controller = await createThemeController(root, source, "system");
    await controller.setMode("system");

    // 初期化で 1 回だけ購読し、同一モード再設定では再購読しない。
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
