/// <reference types="vite/client" />

// ビルド時に vite.config.ts の define で注入されるアプリ表示用バージョン。
// 形式: <major>.<minor>.<revision>.<commit>（例: 1.0.0.53）
declare const __APP_VERSION__: string;
