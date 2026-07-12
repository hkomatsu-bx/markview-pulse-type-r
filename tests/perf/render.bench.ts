// 描画遅延ベンチ（暫定目標 <100ms）。
//
// renderMarkdown（markdown-it）を 小1KB / 中50KB / 大500KB で計測する。

import { bench, describe } from "vitest";

import { renderMarkdown } from "../../src/core/markdown";
import { markdownOfSize, RENDER_SIZES } from "./fixtures";

describe("renderMarkdown 描画遅延（目標 <100ms）", () => {
  const small = markdownOfSize(RENDER_SIZES.small);
  const medium = markdownOfSize(RENDER_SIZES.medium);
  const large = markdownOfSize(RENDER_SIZES.large);

  bench("小 ~1KB", () => {
    renderMarkdown(small);
  });
  bench("中 ~50KB", () => {
    renderMarkdown(medium);
  });
  bench("大 ~500KB", () => {
    renderMarkdown(large);
  });
});
