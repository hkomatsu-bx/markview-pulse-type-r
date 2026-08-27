// mermaid 図の描画（描画後の副作用・遅延ロード）。
//
// core/markdown が出力する <pre class="mermaid"> を mermaid で SVG 図へ置換する。
// 動的 import・DOM 変更という副作用を含むため core ではなく ui 層に置く。
// mermaid は大きいため import("mermaid") で遅延ロードし、対象が無ければロードしない。
// テーマは呼び出し側が明示的に渡す（DOM から読まない）。PDF 書き出しでは画面が
// ダークでもライトで描く必要があり、配色は SVG へ焼き込まれるため上書きの余地が要る。
// 競合対策として世代チェック（isCurrent）で古い描画を破棄する。

import type { MermaidConfig } from "mermaid";

import { sanitizeMermaidSvg } from "../core/markdown";
import { MERMAID_BLOCK_SELECTOR } from "../core/mermaidBlock";

/**
 * 描画済みの mermaid SVG をサニタイズし直す。
 * 変化が無ければ DOM を書き換えない（無駄な再パースと参照の付け替えを避ける）。
 */
function sanitizeRenderedSvg(container: HTMLElement): void {
  for (const svg of Array.from(container.querySelectorAll("svg"))) {
    const original = svg.outerHTML;
    const safe = sanitizeMermaidSvg(original);
    if (safe !== original) {
      svg.outerHTML = safe;
    }
  }
}

// ダーク用のノード配色。mermaid 既定の dark テーマはノード地色が濃いグレーで
// アプリ背景（--bg: #202020）に埋もれるため、ライトのラベンダーに呼応する
// 濃い紫系へ持ち上げ、明るい枠・文字で視認性を確保する。
// themeVariables の上書きを効かせるには base テーマを使う必要がある
// （dark/default などの named テーマは変数上書きをほぼ無視するため）。darkMode:true で
// base に暗背景向けの派生色計算をさせる。
const DARK_THEME_VARIABLES: Readonly<Record<string, string | boolean>> = {
  darkMode: true,
  background: "#202020",
  primaryColor: "#30304a",
  primaryBorderColor: "#a9a9d4",
  primaryTextColor: "#e8e8e8",
  lineColor: "#a0a0a0",
  secondaryColor: "#2b2b3a",
  tertiaryColor: "#262633",
};

/** mermaid 図の配色。画面のテーマとは独立に指定できる（PDF は常にライト）。 */
export type MermaidTheme = "light" | "dark";

/**
 * 指定テーマの mermaid 設定を返す。ダークはノード配色も上書きする。
 * securityLevel は未信頼の図ソースを扱う前提で常に "strict" 固定（緩めない）。
 */
export function buildMermaidConfig(theme: MermaidTheme): MermaidConfig {
  const base: MermaidConfig = {
    startOnLoad: false,
    securityLevel: "strict",
    // mermaid は既定でノード・エッジのラベルを <foreignObject><div> で描く
    // （securityLevel を strict にしても無効化されない）。sanitizeMermaidSvg は
    // SVG のみの allowlist（USE_PROFILES: svg）で、foreignObject は DOMPurify が
    // 中身ごと強制除去するタグのため、ラベル文字列だけが消えてボックスだけ残る。
    // ラベルを純 SVG の <text> で描かせて allowlist の対象内に収める。
    htmlLabels: false,
  };
  if (theme === "dark") {
    return { ...base, theme: "base", themeVariables: DARK_THEME_VARIABLES };
  }
  return { ...base, theme: "default" };
}

// mermaid 描画を直列化する。並行 run は mermaid のグローバル状態（Date.now() ベースの
// id 生成・document 直下の一時要素）を共有し、衝突で相互に壊し得るため、前の描画の完了を
// 待ってから走らせる。連鎖の各段は内部で catch するため、この Promise は reject しない。
let renderChain: Promise<void> = Promise.resolve();

/**
 * container 内の <pre class="mermaid"> を mermaid 図として描画する。
 * 対象が無ければ mermaid を import しない（起動時バンドルを肥大させないための遅延ロード）。
 * 差分強調 ON でも diffDom が mermaid ブロックを不可分に扱う（span を注入しない）ため、
 * ここでは原文の復元処理は不要。
 *
 * @param isCurrent 最新世代かを返す。実行時に false なら DOM に触れず破棄する。
 * @param onError 描画失敗時のハンドラ（無音失敗禁止）。
 * @param theme 図の配色。画面のテーマと独立に指定する。
 * @returns この描画（直列化キュー上の当該段）の完了を表す Promise。
 */
export function renderMermaid(
  container: HTMLElement,
  isCurrent: () => boolean,
  onError: (error: unknown) => void,
  theme: MermaidTheme,
): Promise<void> {
  const nodes = Array.from(
    container.querySelectorAll<HTMLElement>(MERMAID_BLOCK_SELECTOR),
  );
  if (nodes.length === 0) {
    return Promise.resolve();
  }

  renderChain = renderChain.then(async () => {
    // 直列化待ちの間に新しい描画へ置き換わっていれば、この世代は破棄する。
    if (!isCurrent()) {
      return;
    }
    try {
      const mermaid = (await import("mermaid")).default;
      // 遅延 import の完了時に世代が変わっていれば、DOM に触れず破棄する。
      if (!isCurrent()) {
        return;
      }
      // テーマ切替のたびに反映する必要があるため、run 前に毎回設定する。
      mermaid.initialize(buildMermaidConfig(theme));
      // suppressErrors: 不正な図は mermaid が当該ノードへエラー図を描く（可視・無音失敗ではない）。
      // 1 つの失敗が他の図を巻き込まないよう true にする。
      await mermaid.run({ nodes, suppressErrors: true });
      // mermaid の出力は renderMarkdown（唯一の XSS チョークポイント）を通らないため、
      // 描画後にここでサニタイズし直して「DOM へ入る HTML は必ず検査済み」を保つ。
      if (!isCurrent()) {
        return;
      }
      sanitizeRenderedSvg(container);
    } catch (error) {
      // import 失敗など致命的なエラーのみここへ到達する。最新世代のときだけ通知する。
      if (isCurrent()) {
        onError(error);
      }
    }
  });
  return renderChain;
}
