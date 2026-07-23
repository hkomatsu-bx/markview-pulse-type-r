// Markdown 描画。
//
// markdown-it を GFM 寄せで構成する。
// html:true で生 HTML を許可し、GitHub と同じ「許可 → サニタイズ」モデルを再現する。
// 信頼できない .md を開く前提は変わらないため、描画 HTML は必ず DOMPurify を通す。
// renderMarkdown の出力は全描画経路（preview.ts / diffDom.ts）で innerHTML に注入されるため、
// ここが XSS 防御の単一チョークポイントになる（呼び出し側は素通しでよい）。
// CSP（script-src 'self'）との多層防御で担保する。
// CJK 括弧隣接の `「**重要**」` は markdown-it の左右フランキング規則で
// 正しく強調されるため、前処理は不要。
//
// コードブロックは highlight.js で色付けする。バンドル肥大を避けるためコアのみ取り込み、
// よく使う言語だけを明示登録する（未登録言語はエスケープのみで素通し）。
// トークン色は styles.css 側で CSS 変数により明暗テーマへ追従させる。

import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { extractFrontMatter, renderFrontMatterTable } from "./frontMatter";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import markdown from "highlight.js/lib/languages/markdown";
import yaml from "highlight.js/lib/languages/yaml";
import sql from "highlight.js/lib/languages/sql";
import diff from "highlight.js/lib/languages/diff";

// registerLanguage は各言語定義の alias（js/ts/py/sh/html…）も同時に登録する。
const LANGUAGES: readonly (readonly [string, LanguageFn])[] = [
  ["javascript", javascript],
  ["typescript", typescript],
  ["json", json],
  ["bash", bash],
  ["python", python],
  ["rust", rust],
  ["xml", xml],
  ["css", css],
  ["markdown", markdown],
  ["yaml", yaml],
  ["sql", sql],
  ["diff", diff],
];

type LanguageFn = Parameters<typeof hljs.registerLanguage>[1];

for (const [name, fn] of LANGUAGES) {
  hljs.registerLanguage(name, fn);
}

/**
 * フェンス付きコードブロックを色付けする。
 * 登録済み言語のみ highlight.js に通し、未登録・失敗時は空文字を返して
 * markdown-it 側の既定エスケープへ委ねる（生 HTML の混入を防ぐ）。
 */
function highlightCode(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      const { value } = hljs.highlight(code, {
        language: lang,
        ignoreIllegals: true,
      });
      return `<pre class="hljs"><code class="hljs language-${lang}">${value}</code></pre>`;
    } catch {
      // 失敗時はフォールスルーし、既定エスケープへ委ねる。
    }
  }
  return "";
}

/** markdown-it インスタンスを生成する。設定を 1 か所に集約する。 */
function createMarkdownRenderer(): MarkdownIt {
  return new MarkdownIt({
    html: true,
    linkify: true,
    breaks: false,
    highlight: highlightCode,
  });
}

const renderer = createMarkdownRenderer();

// mermaid フェンス（```mermaid）は図として描画するため、コードハイライトせず
// <pre class="mermaid"> を出力する。ソースはエスケープして DOMPurify を通し、
// mermaid はエスケープ復元後の textContent から原文を読む（ui/mermaidRenderer が描画）。
// それ以外の言語は既定の fence（highlightCode 経由）へ委譲する。
type FenceRule = NonNullable<MarkdownIt["renderer"]["rules"]["fence"]>;
const defaultFence: FenceRule =
  renderer.renderer.rules.fence ??
  ((tokens, idx, options, _env, self) =>
    self.renderToken(tokens, idx, options));
renderer.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token?.info.trim().split(/\s+/u)[0] === "mermaid") {
    return `<pre class="mermaid">${renderer.utils.escapeHtml(token.content)}</pre>`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

/**
 * markdown-it の出力 HTML をサニタイズする。
 * DOMPurify の既定の安全プロファイルを用い、<script>・イベントハンドラ属性
 * （onerror 等）・javascript: URI を除去する。class は既定で許可されるため
 * highlight.js のトークン span は保持される。target 属性も既定で除去されるため、
 * リンクは常に同一コンテキストで開き reverse tabnabbing は発生しない。
 * さらに <style> 要素と style 属性を禁止する（GitHub 同様）。既定では許可されるが、
 * 未信頼の .md が全面オーバーレイ（UI 偽装）や background-image によるビーコンで
 * アプリのクロームを覆う CSS 注入を防ぐため。mermaid の SVG/inline style は
 * このサニタイズを経由しない（描画後に別途 DOM 注入される）ため影響しない。
 */
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style"],
    FORBID_ATTR: ["style"],
  });
}

/** Markdown ソースを安全な HTML 文字列へ描画する。 */
export function renderMarkdown(source: string): string {
  // 冒頭の YAML フロントマターを GitHub 風テーブルとして本文先頭に前置する。
  const { data, body } = extractFrontMatter(source);
  const fmHtml = renderFrontMatterTable(data);
  return sanitizeHtml(fmHtml + renderer.render(body));
}
