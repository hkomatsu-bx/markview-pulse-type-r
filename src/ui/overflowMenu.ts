// ツールバー右側のオーバーフロー（「…」）メニュー。
//
// 「…」ボタンでポップオーバーを開閉する。外側クリック / Escape で閉じ、
// 閉じる際はトリガへフォーカスを戻す（キーボード操作の迷子を防ぐ）。
// 表示状態は button の aria-expanded と menu の hidden クラスへ反映する。
// メニュー内の終端操作（開く/印刷/エディタ）でメニューを畳みたい呼び出し側は
// initOverflowMenu が返す close() を使う（本文幅の切替など調整系は開いたまま）。

export interface OverflowMenuElements {
  readonly button: HTMLElement;
  readonly menu: HTMLElement;
}

/** メニューの開閉状態を DOM へ反映する。 */
export function setMenuOpen(els: OverflowMenuElements, open: boolean): void {
  els.button.setAttribute("aria-expanded", String(open));
  els.menu.classList.toggle("hidden", !open);
}

/** 現在開いているか（aria-expanded を真実源とする）。 */
export function isMenuOpen(els: OverflowMenuElements): boolean {
  return els.button.getAttribute("aria-expanded") === "true";
}

export interface OverflowMenuController {
  /** メニューを閉じ、トリガボタンへフォーカスを戻す。 */
  readonly close: () => void;
}

/** 「…」メニューの開閉・外側クリック・Escape を配線する。 */
export function initOverflowMenu(
  els: OverflowMenuElements,
): OverflowMenuController {
  const close = (): void => {
    if (isMenuOpen(els)) {
      setMenuOpen(els, false);
      els.button.focus();
    }
  };

  els.button.addEventListener("click", (event) => {
    // document の外側クリック判定に拾われて即閉じしないよう伝播を止める。
    event.stopPropagation();
    setMenuOpen(els, !isMenuOpen(els));
  });

  document.addEventListener("click", (event) => {
    if (!isMenuOpen(els)) {
      return;
    }
    const target = event.target;
    if (
      target instanceof Node &&
      (els.menu.contains(target) || els.button.contains(target))
    ) {
      return;
    }
    setMenuOpen(els, false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isMenuOpen(els)) {
      event.preventDefault();
      close();
    }
  });

  return { close };
}
