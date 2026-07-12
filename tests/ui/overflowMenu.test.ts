import { describe, it, expect, beforeEach } from "vitest";
import {
  initOverflowMenu,
  setMenuOpen,
  isMenuOpen,
} from "../../src/ui/overflowMenu";

// 「…」オーバーフローメニューの開閉・外側クリック / Escape での閉鎖を jsdom で検証する。

function makeEls(): { button: HTMLButtonElement; menu: HTMLElement } {
  const button = document.createElement("button");
  button.setAttribute("aria-expanded", "false");
  const menu = document.createElement("div");
  menu.classList.add("hidden");
  document.body.append(button, menu);
  return { button, menu };
}

describe("overflowMenu", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("toggles open and closed on button click", () => {
    const els = makeEls();
    initOverflowMenu(els);

    els.button.click();
    expect(isMenuOpen(els)).toBe(true);
    expect(els.menu.classList.contains("hidden")).toBe(false);
    expect(els.button.getAttribute("aria-expanded")).toBe("true");

    els.button.click();
    expect(isMenuOpen(els)).toBe(false);
    expect(els.menu.classList.contains("hidden")).toBe(true);
  });

  it("closes when clicking outside the menu", () => {
    const els = makeEls();
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    initOverflowMenu(els);

    els.button.click();
    expect(isMenuOpen(els)).toBe(true);

    outside.click();
    expect(isMenuOpen(els)).toBe(false);
  });

  it("stays open when clicking an item inside the menu", () => {
    const els = makeEls();
    const item = document.createElement("button");
    els.menu.appendChild(item);
    initOverflowMenu(els);

    els.button.click();
    item.click();

    expect(isMenuOpen(els)).toBe(true);
  });

  it("closes on Escape and returns focus to the button", () => {
    const els = makeEls();
    initOverflowMenu(els);

    els.button.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(isMenuOpen(els)).toBe(false);
    expect(document.activeElement).toBe(els.button);
  });

  it("close() collapses the menu via the controller", () => {
    const els = makeEls();
    const controller = initOverflowMenu(els);

    setMenuOpen(els, true);
    controller.close();

    expect(isMenuOpen(els)).toBe(false);
  });
});
