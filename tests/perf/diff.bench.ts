// 差分計算遅延ベンチ（暫定目標 <50ms, 一般的文書）。
//
// 注: diffEngine.diff は LCS の DP で O(n*m)（n,m はトークン数）。大規模文書は
//     時間・メモリが急増する（既知論点。v1 は実用範囲を許容）。
//     OOM を避けるため計測は「一般的文書」の 1KB〜16KB に絞る。

import { bench, describe } from "vitest";

import { diff } from "../../src/core/diff/diffEngine";
import { DIFF_SIZES, editedVariant, markdownOfSize } from "./fixtures";

describe("diffEngine.diff 計算遅延（目標 <50ms, 一般的文書）", () => {
  for (const bytes of DIFF_SIZES) {
    const prev = markdownOfSize(bytes);
    const next = editedVariant(prev);
    bench(`~${String(Math.round(bytes / 1024))}KB`, () => {
      diff(prev, next);
    });
  }
});
