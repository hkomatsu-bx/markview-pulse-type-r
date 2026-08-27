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

import MarkdownIt, {
  type MarkdownIt as MarkdownItInstance,
  type RendererRule,
} from "markdown-it";
import DOMPurify from "dompurify";
import { extractFrontMatter, renderFrontMatterTable } from "./frontMatter";
import { MERMAID_BLOCK_CLASS } from "./mermaidBlock";
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
function createMarkdownRenderer(): MarkdownItInstance {
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
// markdown-it は fence の既定ルールを必ず備える。欠けているなら想定した版ではなく、
// 委譲先を失った状態でコードブロックが黙って壊れるため、ここで落として気づかせる。
const defaultFence = renderer.renderer.rules.fence;
if (defaultFence === undefined) {
  throw new Error("markdown-it の既定 fence ルールが見つかりません");
}
const mermaidFence: RendererRule = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token?.info.trim().split(/\s+/u)[0] === "mermaid") {
    return `<pre class="${MERMAID_BLOCK_CLASS}">${renderer.utils.escapeHtml(token.content)}</pre>`;
  }
  return defaultFence(tokens, idx, options, env, self);
};
renderer.renderer.rules.fence = mermaidFence;

// 許可タグ（allowlist）。Markdown プレビューの描画に必要なものだけを並べる。
//
// 禁止側を列挙する方式（FORBID_TAGS）は、DOMPurify 既定の許可集合が版を追うごとに
// 広がるため取りこぼしが構造的に避けられない（実際 form/input を禁止しても
// optgroup・label・fieldset・output・dialog は素通りし、入力欄風の偽 UI を組める）。
// GitHub と同じく「必要なタグだけ通す」へ寄せ、未知・将来追加のタグは既定で落とす。
//
// 意図的に含めないもの:
// - style / フォーム系（form・input・button 等）: 全面オーバーレイによる UI 偽装や、
//   偽の資格情報入力（フィッシング）を組み立てられるため。送信自体は CSP が阻むが、
//   入力させた時点で漏洩し得る。
// - script・iframe・object 等: DOMPurify 既定でも落ちるが、allowlist なので自明に不許可。
const ALLOWED_TAGS: readonly string[] = [
  // 見出し・段落・区切り
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "hr",
  "div",
  "span",
  // 強調・インライン
  "strong",
  "b",
  "em",
  "i",
  "s",
  "del",
  "ins",
  "mark",
  "sub",
  "sup",
  "small",
  "u",
  "abbr",
  "cite",
  "q",
  "dfn",
  "time",
  "kbd",
  "samp",
  "var",
  // リンク・画像
  "a",
  "img",
  // リスト
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  // 引用・コード
  "blockquote",
  "pre",
  "code",
  // 表
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "colgroup",
  "col",
  // 折りたたみ（GFM で使われる）
  "details",
  "summary",
  // ルビ（日本語文書）
  "ruby",
  "rt",
  "rp",
  "rb",
];

// 許可属性。既定から style を除き、描画に要るものだけを通す。
// class は highlight.js のトークン span と mermaid の pre で必須。
const ALLOWED_ATTR: readonly string[] = [
  "href",
  "src",
  "alt",
  "title",
  "class",
  "id",
  "start",
  "reversed",
  "type",
  "colspan",
  "rowspan",
  "align",
  "width",
  "height",
  "open",
  "datetime",
  "lang",
  "dir",
  "aria-hidden",
];

// DOMPurify は window の無い環境で isSupported=false となり、sanitize が入力を
// そのまま返す（例外も警告も出ない）。core は DOM 非依存という規約に対する意図的な
// 例外としてここに置いているが、その代償として「サニタイズが黙って無効化される」
// 最悪ケースを負う。読み込み時に検査して落とし、生 HTML が素通りする状態で
// アプリが動き続けることを構造的に排除する。
if (!DOMPurify.isSupported) {
  throw new Error(
    "DOMPurify を初期化できません（DOM の無い環境では Markdown を描画できません）",
  );
}

/**
 * markdown-it の出力 HTML をサニタイズする。
 *
 * ALLOWED_TAGS / ALLOWED_ATTR の allowlist 方式で、列挙されていない要素・属性は
 * すべて落とす（<script>・イベントハンドラ属性・style・フォーム系を含む）。
 * javascript: URI は DOMPurify が既定の URI 検査で除去する。target を許可しないため、
 * リンクは常に同一コンテキストで開き reverse tabnabbing は発生しない。
 * mermaid の SVG/inline style はこのサニタイズを経由しない（描画後に別途 DOM 注入
 * される）ため影響しない。
 */
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTR],
  });
}

/**
 * mermaid が生成した SVG をサニタイズする。
 *
 * mermaid.run は `renderMarkdown` を経由せず DOM へ直接 SVG を注入するため、
 * 放置すると「全ての innerHTML 流入はサニタイズ済み」という不変条件が破れ、
 * 安全性が mermaid 内蔵サニタイザ（securityLevel:"strict"）への全面委任になる。
 * 図の見た目に必要な SVG プロファイルと `<style>` は許可しつつ、スクリプトや
 * イベントハンドラ属性は落として多層防御を回復する。
 */
export function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    // mermaid は図の配色・字送りを SVG 内の <style> に出力するため、ここだけ許可する
    // （本文側の style 禁止とは別扱い。SVG 内に閉じるため UI 偽装には使えない）。
    ADD_TAGS: ["style"],
  });
}

/** Markdown ソースを安全な HTML 文字列へ描画する。 */
export function renderMarkdown(source: string): string {
  // 冒頭の YAML フロントマターを GitHub 風テーブルとして本文先頭に前置する。
  const { data, body } = extractFrontMatter(source);
  const fmHtml = renderFrontMatterTable(data);
  return sanitizeHtml(fmHtml + renderer.render(body));
}
