import { describe, expect, it } from "vitest";
import {
  parseDate,
  parseYen,
  parseYenLoose,
} from "../src/parse.js";

describe("parseYen（円必須）", () => {
  it("円つき金額を数値化する（負値・カンマ対応）", () => {
    expect(parseYen("1,234,567円")).toBe(1234567);
    expect(parseYen("-12,345円")).toBe(-12345);
    expect(parseYen("35円")).toBe(35);
    expect(parseYen("0円")).toBe(0);
  });

  it("「円」が無い入力は null（日付・カレンダー数字の誤爆防止）", () => {
    expect(parseYen("10/08")).toBeNull();
    expect(parseYen("2026-10-08")).toBeNull();
    expect(parseYen("31")).toBeNull();
    expect(parseYen("")).toBeNull();
  });
});

describe("parseYenLoose（円なし許容）", () => {
  it("カンマ区切りの数値をそのまま parse する", () => {
    expect(parseYenLoose("1,234")).toBe(1234);
    expect(parseYenLoose("-22,000\n(振替)")).toBe(-22000);
    expect(parseYenLoose("300,000")).toBe(300000);
    expect(parseYenLoose("0")).toBe(0);
  });

  it("数値を含まないセルは null", () => {
    expect(parseYenLoose("")).toBeNull();
    expect(parseYenLoose("(振替)")).toBeNull();
    expect(parseYenLoose("振替")).toBeNull();
  });
});

describe("parseDate", () => {
  it("YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD を正規化する", () => {
    expect(parseDate("2026-10-09")).toBe("2026-10-09");
    expect(parseDate("2026/10/9")).toBe("2026-10-09");
    expect(parseDate("2026.10.09")).toBe("2026-10-09");
  });

  it("MM/DD(曜) 形式を受ける（年は now の年で補完）", () => {
    expect(parseDate("10/02(金)", new Date(2026, 9, 9))).toBe("2026-10-02");
    expect(parseDate("1/5(月)", new Date(2026, 0, 9))).toBe("2026-01-05");
  });

  it("日付でない文字列は null", () => {
    expect(parseDate("総資産")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});
