// 右クリックのカスタムコンテキストメニュー。
//
// WebView 既定の右クリックメニューを抑止し、本メニューを表示する。
// 項目（コピー/表示幅/印刷/エディタ）の活性状態と動作は呼び出し側が渡す。
// クリック座標へ配置し、ビューポート外へはみ出さないようクランプする。
// 外側クリック / Escape / スクロール・リサイズ / 項目実行で閉じる。

export interface ContextMenuElements {
  readonly menu: HTMLElement;
  readonly copy: HTMLButtonElement;
  readonly width: HTMLButtonElement;
  readonly print: HTMLButtonElement;
  readonly editor: HTMLButtonElement;
}

/** 右クリック時点のコンテキスト（活性判定と表示幅ラベル）。 */
export interface ContextMenuState {
  /** 選択文字列。無選択なら null（コピーを非活性化）。 */
  readonly selectionText: string | null;
  /** アクティブタブの有無（印刷/エディタの活性を決める）。 */
  readonly hasActiveTab: boolean;
  /** 表示幅の現在ラベル（例: 標準）。 */
  readonly widthLabel: string;
}

export interface ContextMenuHandlers {
  /** 右クリック時に呼ばれ、現在のコンテキストを返す。 */
  readonly resolve: () => ContextMenuState;
  readonly onCopy: (text: string) => void;
  readonly onWidth: () => void;
  readonly onPrint: () => void;
  readonly onEditor: () => void;
}

/** ビューポート内に収まるよう座標をクランプする純関数。 */
export function clampToViewport(
  x: number,
  y: number,
  menuW: number,
  menuH: number,
  viewW: number,
  viewH: number,
  margin = 4,
): { readonly left: number; readonly top: number } {
  const left = Math.max(margin, Math.min(x, viewW - menuW - margin));
  const top = Math.max(margin, Math.min(y, viewH - menuH - margin));
  return { left, top };
}

function setDisabled(button: HTMLButtonElement, disabled: boolean): void {
  button.disabled = disabled;
  button.setAttribute("aria-disabled", String(disabled));
}

/**
 * 右クリックのカスタムコンテキストメニューを配線する。
 * 既定メニューは常に抑止し、本メニューを表示する。
 */
export function initContextMenu(
  els: ContextMenuElements,
  handlers: ContextMenuHandlers,
): void {
  let selectionText: string | null = null;

  const isOpen = (): boolean => !els.menu.classList.contains("hidden");

  const close = (): void => {
    if (isOpen()) {
      els.menu.classList.add("hidden");
    }
  };

  const open = (clientX: number, clientY: number): void => {
    const ctx = handlers.resolve();
    selectionText = ctx.selectionText;

    setDisabled(els.copy, ctx.selectionText === null);
    setDisabled(els.print, !ctx.hasActiveTab);
    setDisabled(els.editor, !ctx.hasActiveTab);

    const label = els.width.querySelector(".ctx-width-label");
    if (label instanceof HTMLElement) {
      label.textContent = ctx.widthLabel;
    }

    // 先に可視化して寸法を測り、はみ出さない位置へ配置する。
    els.menu.classList.remove("hidden");
    const { left, top } = clampToViewport(
      clientX,
      clientY,
      els.menu.offsetWidth,
      els.menu.offsetHeight,
      window.innerWidth,
      window.innerHeight,
    );
    els.menu.style.left = `${String(left)}px`;
    els.menu.style.top = `${String(top)}px`;
  };

  window.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    open(event.clientX, event.clientY);
  });

  // 項目実行: 動作後に閉じる。非活性項目は何もしない。
  const run = (action: () => void) => (): void => {
    action();
    close();
  };
  els.copy.addEventListener(
    "click",
    run(() => {
      if (selectionText !== null) {
        handlers.onCopy(selectionText);
      }
    }),
  );
  els.width.addEventListener("click", run(handlers.onWidth));
  els.print.addEventListener("click", run(handlers.onPrint));
  els.editor.addEventListener("click", run(handlers.onEditor));

  // 外側クリックで閉じる（メニュー内クリックは各 run が閉じるため二重でも無害）。
  document.addEventListener("click", (event) => {
    if (!isOpen()) {
      return;
    }
    const target = event.target;
    if (target instanceof Node && els.menu.contains(target)) {
      return;
    }
    close();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      event.preventDefault();
      close();
    }
  });

  // スクロール/リサイズで座標がずれるため閉じる。
  window.addEventListener("scroll", close, true);
  window.addEventListener("resize", close);
}
