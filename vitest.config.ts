import { defineConfig } from "vitest/config";

// 中核ロジック（差分・Markdown・タブ）の単体試験設定（NFR-05）。
// diffDom など DOM 依存テストのため jsdom を既定環境にする。
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
