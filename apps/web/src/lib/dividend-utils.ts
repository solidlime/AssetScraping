/** 配当ページの表示ロジック（純粋関数）。表示と要件の分岐をここに集約する。 */

export const REASON_OUT_OF_SCOPE = "対象外カテゴリ";

export interface DividendStatusInput {
  resolved: boolean;
  yahooSymbol: string | null;
  reason: string | null;
}

export interface DividendStatus {
  label: string;
  variant: "secondary" | "outline" | "warning";
}

/**
 * 解決状態の表示区分。
 * 未解決のうち「対象外カテゴリ」は要対応ではないため「配当対象外」として区別する。
 */
export function dividendRowStatus(row: DividendStatusInput): DividendStatus {
  if (row.resolved) {
    return row.yahooSymbol
      ? { label: "自動（Yahoo）", variant: "secondary" }
      : { label: "手動", variant: "outline" };
  }
  if (row.reason === REASON_OUT_OF_SCOPE) {
    return { label: "配当対象外", variant: "outline" };
  }
  return { label: "未解決", variant: "warning" };
}

export interface UnresolvedSourceRow {
  holdingName: string;
  rawHoldingName: string;
}

export function toUnresolvedItems(forecast: {
  rows: UnresolvedSourceRow[];
  unresolved: Array<{ holdingName: string; category: string | null; reason: string }>;
}): Array<{ holdingName: string; rawHoldingName: string; category: string | null; reason: string }> {
  return forecast.unresolved
    .filter((u) => u.reason !== REASON_OUT_OF_SCOPE)
    .map((u) => {
      const row = forecast.rows.find((r) => r.holdingName === u.holdingName);
      return {
        holdingName: u.holdingName,
        rawHoldingName: row?.rawHoldingName ?? u.holdingName,
        category: u.category,
        reason: u.reason,
      };
    });
}
