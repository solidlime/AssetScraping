import { describe, expect, it } from "vitest";
import { dividendRowStatus, toUnresolvedItems } from "../../lib/dividend-utils";

describe("dividendRowStatus", () => {
  it("Yahoo シンボルが解決済みなら自動", () => {
    expect(dividendRowStatus({ resolved: true, yahooSymbol: "JEPQ", reason: null })).toEqual({
      label: "自動（Yahoo）",
      variant: "secondary",
    });
  });

  it("手動マッピング（シンボルなしで解決）は手動", () => {
    expect(dividendRowStatus({ resolved: true, yahooSymbol: null, reason: null })).toEqual({
      label: "手動",
      variant: "outline",
    });
  });

  it("対象外カテゴリは未解決ではなく配当対象外として区別する", () => {
    expect(
      dividendRowStatus({ resolved: false, yahooSymbol: null, reason: "対象外カテゴリ" }),
    ).toEqual({ label: "配当対象外", variant: "outline" });
  });

  it("その他の未解決は未解決", () => {
    expect(
      dividendRowStatus({ resolved: false, yahooSymbol: null, reason: "シンボル未解決" }),
    ).toEqual({ label: "未解決", variant: "warning" });
  });
});

describe("toUnresolvedItems", () => {
  const forecast = {
    rows: [
      { holdingName: "A", rawHoldingName: "A（株式）_2" },
      { holdingName: "B", rawHoldingName: "B" },
    ],
    unresolved: [
      { holdingName: "A", category: "株式(現物)", reason: "シンボル未解決" },
      { holdingName: "B", category: "預金・現金", reason: "対象外カテゴリ" },
    ],
  };

  it("対象外カテゴリを除外し、rawHoldingName を引き当てる", () => {
    expect(toUnresolvedItems(forecast)).toEqual([
      {
        holdingName: "A",
        rawHoldingName: "A（株式）_2",
        category: "株式(現物)",
        reason: "シンボル未解決",
      },
    ]);
  });
});
