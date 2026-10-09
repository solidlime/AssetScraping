export function formatYen(n: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(n);
}

/** 1234567 -> "1,234,567円" （符号オプション付き） */
export function formatCurrency(amount: number, showPlusSign = false): string {
  const sign = showPlusSign && amount > 0 ? "+" : "";
  return `${sign}${amount.toLocaleString("ja-JP")}円`;
}

export function formatPercent(value: number, decimals = 1): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

/** 前日比など増減値の色クラス。収入=青系 / 支出=赤系（本家ダッシュボードの慣習に準拠） */
export function deltaColorClass(value: number): string {
  if (value > 0) return "text-blue-700";
  if (value < 0) return "text-red-700";
  return "text-neutral-500";
}

/** ISO 日付文字列 ("2025-01-31") -> "2025年1月31日" */
export function formatDate(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

/** "2025-01" -> "2025年1月" */
export function formatMonth(monthStr: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthStr);
  if (!m) return monthStr;
  return `${Number(m[1])}年${Number(m[2])}月`;
}
