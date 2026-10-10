import { describe, expect, it } from "vitest";
import { monthlySavingsRate } from "./monthly-summary-utils";

/** 実測日 2026-10-10（JST）。当月 = 2026-10 */
const NOW = new Date("2026-10-10T06:00:00.000Z");

describe("monthlySavingsRate", () => {
  it("当月は null（率を出さない）", () => {
    // 実測値: 収入 16円 / 支出 74,713円 → 旧実装は -466856% の異常値
    expect(monthlySavingsRate("2026-10", 16, 74_713, NOW)).toBeNull();
  });

  it("過去月は数値（貯蓄率）を返す", () => {
    // 2026-09: 収入 584,477 / 支出 473,209 → (111268/584477)*100 = 19.037...
    expect(monthlySavingsRate("2026-09", 584_477, 473_209, NOW)).toBeCloseTo(19.037, 2);
    expect(monthlySavingsRate("2026-05", 636_232, 526_600, NOW)).toBeCloseTo(17.231, 2);
  });

  it("収入 0 のときは率を出さない（null）", () => {
    expect(monthlySavingsRate("2026-09", 0, 1_000, NOW)).toBeNull();
  });
});
