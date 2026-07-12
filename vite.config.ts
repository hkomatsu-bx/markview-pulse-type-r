import { defineConfig } from "vite";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// アプリ表示用バージョン: <major>.<minor>.<revision>.<commit>
// 先頭3つは package.json（固定値・単一の真実）、末尾はコミット回数（git）。
// 配布物（package.json / tauri.conf.json）の version 自体は固定3桁のまま。
function resolveAppVersion(): string {
  const pkg = JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
  ) as { version: string };
  let commitCount = "0";
  try {
    commitCount = execSync("git rev-list --count HEAD", {
      encoding: "utf-8",
    }).trim();
  } catch {
    // git 不在（ソース tarball ビルド等）。コミット回数は 0 にフォールバック。
    commitCount = "0";
  }
  return `${pkg.version}.${commitCount}`;
}

const appVersion = resolveAppVersion();

// Tauri 開発向け設定。`tauri dev` / `tauri build` 時にのみ意味を持つ。
// https://vite.dev/config/
export default defineConfig(async () => ({
  // 1. Rust のエラー出力を Vite が消さないようにする
  clearScreen: false,
  // バージョン文字列をビルド時にバンドルへ静的に埋め込む（CSP 非抵触）。
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  // 2. Tauri は固定ポートを期待する。空いていなければ失敗させる
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. src-tauri は Vite の監視対象から除外する
      ignored: ["**/src-tauri/**"],
    },
  },
}));
