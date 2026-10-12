"use client";

// recharts はモジュール読み込み時に Global.isSsr を一度だけ評価し、その値で初回レンダー
// 出力を変える（例: Bar の isAnimationActive）。そのため "use client" でも SSR されると
// hydration mismatch (#418) になる。チャートをクライアント専用レンダリングにして解消する。
//
// 制約: ssr:false は Client Component からしか使えないため、Server Component の各ラッパーは
// このファイル経由で読み込む。loading の高さは各チャートの実高さに合わせる。
import dynamic from "next/dynamic";

export const AssetBreakdownChartClient = dynamic(
  () => import("../info/asset-breakdown-chart.client").then((m) => m.AssetBreakdownChartClient),
  { ssr: false, loading: () => <div style={{ height: 128 }} /> },
);

export const AssetHistoryChartClient = dynamic(
  () => import("../info/asset-history-chart.client").then((m) => m.AssetHistoryChartClient),
  { ssr: false, loading: () => <div style={{ height: 350 }} /> },
);

export const BalanceSheetChartClient = dynamic(
  () => import("../info/balance-sheet-chart.client").then((m) => m.BalanceSheetChartClient),
  { ssr: false, loading: () => <div style={{ height: 400 }} /> },
);

export const MonthlyIncomeExpenseChartClient = dynamic(
  () =>
    import("../info/monthly-income-expense-chart.client").then(
      (m) => m.MonthlyIncomeExpenseChartClient,
    ),
  { ssr: false, loading: () => <div style={{ height: 350 }} /> },
);

export const HoldingsTableClient = dynamic(
  () => import("../info/holdings-table.client").then((m) => m.HoldingsTableClient),
  { ssr: false, loading: () => <div style={{ height: 224 }} /> },
);

export const UnrealizedGainCardClient = dynamic(
  () => import("../info/unrealized-gain-card.client").then((m) => m.UnrealizedGainCardClient),
  { ssr: false, loading: () => <div style={{ height: 180 }} /> },
);

export const TransactionStatsClient = dynamic(
  () => import("../info/transaction-stats.client").then((m) => m.TransactionStatsClient),
  { ssr: false, loading: () => <div style={{ height: 280 }} /> },
);

export const DividendCalendarChartClient = dynamic(
  () =>
    import("../dividends/dividend-calendar.client").then((m) => m.DividendCalendarChartClient),
  { ssr: false, loading: () => <div style={{ height: 350 }} /> },
);

export const CategoryBreakdownClient = dynamic(
  () =>
    import("../info/category-breakdown/category-breakdown.client").then(
      (m) => m.CategoryBreakdownClient,
    ),
  { ssr: false, loading: () => <div style={{ height: 128 }} /> },
);
