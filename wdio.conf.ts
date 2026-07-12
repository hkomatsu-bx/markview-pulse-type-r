// WebdriverIO 設定 — tauri-driver でネイティブ WebView2 実機を駆動する E2E（aidlc 未解決#5）。
//
// 前提（このセッションでは未実行・ユーザー環境で実施）:
//   1. `cargo install tauri-driver`（tauri-driver を PATH に通す）
//   2. WebView2 ランタイムに一致する msedgedriver.exe を用意
//      （未一致だと起動失敗。パスは環境変数 TAURI_NATIVE_DRIVER で指定可）
//   3. アプリをビルド: `npm run tauri build`（または debug 体を TAURI_APP_PATH で指定）
//   4. 実行: `npm run test:e2e`
//
// 環境変数:
//   TAURI_APP_PATH       … 対象 exe パス（既定: release 体）
//   TAURI_NATIVE_DRIVER  … msedgedriver.exe のパス（Windows で未 PATH の場合に指定）

import { spawn, type ChildProcess } from "node:child_process";
import process from "node:process";

import { LAUNCH_FILES, prepareFixtures } from "./e2e/helpers/fixtures";

const APP_BINARY =
  process.env.TAURI_APP_PATH ??
  "./src-tauri/target/release/markview-pulse-type-r.exe";
const NATIVE_DRIVER = process.env.TAURI_NATIVE_DRIVER;

let tauriDriver: ChildProcess | undefined;

export const config: WebdriverIO.Config = {
  runner: "local",
  hostname: "127.0.0.1",
  port: 4444,

  specs: ["./e2e/specs/**/*.e2e.ts"],
  // ネイティブ WebView2 は単一インスタンスで直列実行する。
  maxInstances: 1,

  capabilities: [
    {
      // tauri-driver にアプリ本体と CLI 起動引数を渡す。
      // args の .md は get_launch_files 経由でタブとして開かれる（FR-00 開く→描画の代替経路）。
      "tauri:options": {
        application: APP_BINARY,
        args: [...LAUNCH_FILES],
      },
    } as unknown as WebdriverIO.Capabilities,
  ],

  logLevel: "warn",
  bail: 0,
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 60000,
  },

  // セッション全体の開始前に一時フィクスチャを再生成する。
  onPrepare: () => {
    prepareFixtures();
  },

  // 各セッションの直前に tauri-driver を起動し、終了後に停止する（公式 Tauri E2E 構成）。
  beforeSession: () => {
    const driverArgs = NATIVE_DRIVER ? ["--native-driver", NATIVE_DRIVER] : [];
    tauriDriver = spawn("tauri-driver", driverArgs, {
      stdio: [null, process.stdout, process.stderr],
    });
    tauriDriver.on("error", (error: Error) => {
      // 握りつぶさず明示する。tauri-driver / msedgedriver 未導入が主因。
      process.stderr.write(
        `tauri-driver の起動に失敗しました。\`cargo install tauri-driver\` と msedgedriver を確認してください: ${error.message}\n`,
      );
    });
  },
  afterSession: () => {
    tauriDriver?.kill();
  },
};
