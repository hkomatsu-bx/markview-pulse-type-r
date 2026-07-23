import { describe, it, expect } from "vitest";
import { isLocalImageSrc } from "../../src/core/media/imageSrc";

describe("isLocalImageSrc", () => {
  it("相対パスはローカルと判定する", () => {
    expect(isLocalImageSrc("images/x.png")).toBe(true);
    expect(isLocalImageSrc("./x.png")).toBe(true);
    expect(isLocalImageSrc("../shared/x.png")).toBe(true);
  });

  it("Windows ドライブパス・POSIX 絶対パスはローカルと判定する", () => {
    expect(isLocalImageSrc("C:\\Users\\me\\x.png")).toBe(true);
    expect(isLocalImageSrc("C:/Users/me/x.png")).toBe(true);
    expect(isLocalImageSrc("/abs/x.png")).toBe(true);
  });

  it("スキーム付き URL は非ローカル（素通し）と判定する", () => {
    expect(isLocalImageSrc("http://example.com/x.png")).toBe(false);
    expect(isLocalImageSrc("https://example.com/x.png")).toBe(false);
    expect(isLocalImageSrc("data:image/png;base64,AAAA")).toBe(false);
    expect(isLocalImageSrc("blob:https://x/y")).toBe(false);
    expect(isLocalImageSrc("file:///C:/x.png")).toBe(false);
  });

  it("スキーム判定は大文字小文字を無視する", () => {
    expect(isLocalImageSrc("HTTPS://example.com/x.png")).toBe(false);
  });

  it("プロトコル相対 URL は非ローカルと判定する", () => {
    expect(isLocalImageSrc("//cdn.example.com/x.png")).toBe(false);
  });

  it("UNC パス（\\\\host）は非ローカルと判定する（NTLM 漏洩対策の多層防御）", () => {
    expect(isLocalImageSrc("\\\\attacker.example.com\\share\\x.png")).toBe(
      false,
    );
    expect(isLocalImageSrc("\\/host/x.png")).toBe(false);
    expect(isLocalImageSrc("/\\host/x.png")).toBe(false);
  });

  it("空・空白のみは false", () => {
    expect(isLocalImageSrc("")).toBe(false);
    expect(isLocalImageSrc("   ")).toBe(false);
  });
});
