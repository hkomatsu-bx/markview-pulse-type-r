// ボタンの活性/非活性の反映。
//
// `disabled` 属性と `aria-disabled` は必ず対で更新する必要がある（片方だけだと
// 支援技術と実挙動が食い違う）。ツールバーとコンテキストメニューが別々に
// 実装していたため、ここへ一本化する。

/** ボタンの活性状態を反映する（`disabled` と `aria-disabled` を同期）。 */
export function setDisabled(element: HTMLElement, disabled: boolean): void {
  element.toggleAttribute("disabled", disabled);
  element.setAttribute("aria-disabled", String(disabled));
}

/** 複数ボタンへまとめて反映する。 */
export function setAllDisabled(
  elements: readonly HTMLElement[],
  disabled: boolean,
): void {
  for (const element of elements) {
    setDisabled(element, disabled);
  }
}
