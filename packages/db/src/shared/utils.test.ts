import { describe, it, expect } from "vitest";
import { generateMonthRange } from "./utils.ts";

describe("generateMonthRange", () => {
  it("2つの月の間のすべての月を降順で返す", () => {
    const result = generateMonthRange("2025-10", "2026-01");

    expect(result).toEqual(["2026-01", "2025-12", "2025-11", "2025-10"]);
  });

  it("同じ月の場合は1つの要素を返す", () => {
    const result = generateMonthRange("2026-01", "2026-01");

    expect(result).toEqual(["2026-01"]);
  });

  it("年をまたぐ場合も正しく動作する", () => {
    const result = generateMonthRange("2024-11", "2025-02");

    expect(result).toEqual(["2025-02", "2025-01", "2024-12", "2024-11"]);
  });
});
