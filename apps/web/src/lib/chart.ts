/** Recharts ResponsiveContainer の初期寸法（本家準拠）。 */
export const CHART_INITIAL_DIMENSION = { width: 1, height: 1 };

/** Recharts の <Tooltip contentStyle={...}> に渡す共通スタイル。CSS 変数でテーマ連動。 */
export const chartTooltipStyle: React.CSSProperties = {
  backgroundColor: "var(--color-card)",
  color: "var(--color-card-foreground)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-lg)",
  fontSize: "12px",
  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
};

/** Recharts のラベルをオブジェクト文字列化せず整形する。 */
export function formatChartLabel(label: unknown): string {
  return typeof label === "string" || typeof label === "number" ? String(label) : "";
}
