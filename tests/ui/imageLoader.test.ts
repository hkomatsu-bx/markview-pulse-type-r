import { describe, it, expect, vi, beforeEach } from "vitest";

// fileClient を丸ごとモックし、@tauri-apps 依存を読み込まずに描画経路を検証する。
vi.mock("../../src/core/fs/fileClient", () => ({
  readImageDataUri: vi.fn(),
}));

import { readImageDataUri } from "../../src/core/fs/fileClient";
import { loadLocalImages, IMAGE_ERROR_CLASS } from "../../src/ui/imageLoader";

const mockRead = vi.mocked(readImageDataUri);

describe("loadLocalImages", () => {
  beforeEach(() => {
    mockRead.mockReset();
  });

  it("ローカル img の src を data URI へ差し替え、remote は触らない", async () => {
    mockRead.mockResolvedValue("data:image/png;base64,AAAA");
    const container = document.createElement("div");
    container.innerHTML =
      '<img src="images/x.png"><img src="https://example.com/y.png">';

    await loadLocalImages(container, "/docs/doc.md", () => true);

    const imgs = container.querySelectorAll("img");
    expect(imgs[0]?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(imgs[1]?.getAttribute("src")).toBe("https://example.com/y.png");
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(mockRead).toHaveBeenCalledWith("/docs/doc.md", "images/x.png");
  });

  it("percent-encoded な src はデコードして Rust へ渡す", async () => {
    mockRead.mockResolvedValue("data:image/png;base64,AAAA");
    const container = document.createElement("div");
    container.innerHTML = '<img src="images/%E6%A4%9C%E7%B4%A2.png">';

    await loadLocalImages(container, "/docs/doc.md", () => true);

    expect(mockRead).toHaveBeenCalledWith("/docs/doc.md", "images/検索.png");
  });

  it("失敗時は元の src を残しエラークラスを付す（ダイアログは出さない）", async () => {
    mockRead.mockRejectedValue(new Error("not found"));
    const container = document.createElement("div");
    container.innerHTML = '<img src="images/missing.png">';

    await loadLocalImages(container, "/docs/doc.md", () => true);

    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("images/missing.png");
    expect(img?.classList.contains(IMAGE_ERROR_CLASS)).toBe(true);
  });

  it("古い世代では DOM を触らない（stale 上書き防止）", async () => {
    mockRead.mockResolvedValue("data:image/png;base64,AAAA");
    const container = document.createElement("div");
    container.innerHTML = '<img src="images/x.png">';

    await loadLocalImages(container, "/docs/doc.md", () => false);

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "images/x.png",
    );
  });

  it("ローカル画像が無ければ Rust を呼ばない", async () => {
    const container = document.createElement("div");
    container.innerHTML = '<p>no image</p><img src="data:image/png;base64,AA">';

    await loadLocalImages(container, "/docs/doc.md", () => true);

    expect(mockRead).not.toHaveBeenCalled();
  });
});
