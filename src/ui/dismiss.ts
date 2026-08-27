// ポップアップの解除（閉じる）配線。
//
// 「外側クリックで閉じる」「Escape で閉じる」は オーバーフローメニューと
// コンテキストメニューがそれぞれ実装していた。挙動を変えるとき（capture 指定や
// pointerdown 化、フォーカス復帰）に片方だけ直ると操作感が乖離するため一本化する。
// メニュー固有の差（スクロール/リサイズで閉じる、フォーカスを戻す）は
// 呼び出し側が close の中身で表現する。

export interface DismissOptions {
  /** 現在開いているか。閉じている間は何もしない。 */
  readonly isOpen: () => boolean;
  /** 外側クリックで閉じる操作。二重呼び出しされても安全であること。 */
  readonly close: () => void;
  /**
   * Escape で閉じる操作（省略時は `close`）。
   * キーボード操作ではトリガへフォーカスを戻したい一方、外側クリックでは
   * クリック先へフォーカスが移るのが自然なため、別々に指定できるようにする。
   */
  readonly closeOnEscape?: () => void;
  /**
   * 「内側」とみなす要素。ここに含まれるクリックでは閉じない。
   * トリガボタン自身も含めると、開閉トグルが即閉じに食われない。
   */
  readonly insideOf: readonly HTMLElement[];
}

/** 外側クリックと Escape での解除を配線する。 */
export function wireDismiss(options: DismissOptions): void {
  const { isOpen, close, insideOf } = options;
  const closeOnEscape = options.closeOnEscape ?? close;

  document.addEventListener("click", (event) => {
    if (!isOpen()) {
      return;
    }
    const target = event.target;
    if (target instanceof Node && insideOf.some((el) => el.contains(target))) {
      return;
    }
    close();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      event.preventDefault();
      closeOnEscape();
    }
  });
}
