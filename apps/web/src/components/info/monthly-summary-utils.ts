import { getJstYearMonthKey } from "@asset-scraping/date-utils";

/**
 * 月次カードの貯蓄率(%)。
 *
 * **当月は null（率を表示しない）**。当月の `/cf` 明細は未確定分（楽天イチバ等）を含むため
 * 収入が数円・支出が数万円になり、率が -466856% 等の異常値になる（実測 2026-10: 収入 16 円 /
 * 支出 74,713 円）。過去月は `cash_flow_monthly` の合計行ベースで安定するので従来どおり算出する。
 */
export function monthlySavingsRate(
  month: string,
  totalIncome: number,
  totalExpense: number,
  now: Date = new Date(),
): number | null {
  if (month === getJstYearMonthKey(now)) return null;
  return totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : null;
}
