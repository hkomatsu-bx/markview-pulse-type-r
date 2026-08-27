import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// CSP はアプリの防御方針そのものだが、実体は設定ファイルの 1 行しかない。
// 「リモート画像を遮断する（トラッキングビーコン対策）」「スクリプトは自己配信のみ」
// といった意思決定が、語を 1 つ足すだけで無音のうちに崩れるのを防ぐため、
// 方針を実行可能な形で固定する。

interface TauriConfig {
  readonly app: { readonly security: { readonly csp: string } };
}

// jsdom 環境では import.meta.url が file: にならないため、cwd（リポジトリ直下で
// vitest が動く）からの相対で解決する。
const config = JSON.parse(
  readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf-8"),
) as TauriConfig;

/** CSP をディレクティブ名 → 値の集合へ分解する。 */
function parseCsp(csp: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) {
      directives.set(name, values);
    }
  }
  return directives;
}

describe("CSP（tauri.conf.json）", () => {
  const csp = parseCsp(config.app.security.csp);

  it("画像はローカルと data: のみ許可する（外部への画像要求を遮断）", () => {
    // 未信頼の .md が外部へ画像を要求できると、開いた事実と IP が送出される
    // トラッキングビーコンになる。https: を足すとこの防御が消える。
    expect(csp.get("img-src")).toEqual(["'self'", "data:"]);
  });

  it("スクリプトは自己配信のみ（inline / eval を許可しない）", () => {
    const scriptSrc = csp.get("script-src") ?? [];
    expect(scriptSrc).toEqual(["'self'"]);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("既定の取得先を自己配信に限り、プラグイン・フレームを禁止する", () => {
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("frame-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
  });
});
