// ESLint flat config — ガイド §11（typescript-eslint strict-type-checked / stylistic-type-checked）。
// 整形は Prettier に委譲し、eslint-config-prettier で整形系ルールを無効化する。
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "coverage",
      "node_modules",
      "src-tauri",
      "*.config.*",
      // E2E は専用 tsconfig（tsconfig.e2e.json）で型検証する。wdio グローバルの
      // 緩い型付けがアプリ用 strict-type-checked と相容れないため lint 対象外とする。
      "e2e",
      "wdio.conf.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // noUncheckedIndexedAccess 下で、確保済みマトリクス等の証明可能に安全な断定を許容する
      // （ガイド §5 ET45：型付き関数の内部に安全なアサーションを閉じ込める）。
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      // テストはモック・スタブで空関数や any 戻りを使うため緩和する（§12 はテストでの簡略化を許容）。
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  eslintConfigPrettier,
);
