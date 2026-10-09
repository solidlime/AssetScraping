import { hasInvestmentHoldings } from "@asset-scraping/db";
import type { Metadata } from "next";
import { AssetBreakdownChart } from "../components/info/asset-breakdown-chart";
import { AssetHistoryChart } from "../components/info/asset-history-chart";
import { DailyChangeCard } from "../components/info/daily-change-card";
import { MonthlyBalanceCard } from "../components/info/monthly-balance-card";
import { MonthlyIncomeExpenseChart } from "../components/info/monthly-income-expense-chart";
import { PageLayout } from "../components/layout/page-layout";

export const metadata: Metadata = {
  title: "ダッシュボード",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const showDailyChange = await hasInvestmentHoldings();

  return (
    <PageLayout title="ダッシュボード">
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        <AssetBreakdownChart className="lg:col-span-2" />
        <MonthlyBalanceCard />
      </div>

      {showDailyChange && <DailyChangeCard />}

      <AssetHistoryChart />

      <MonthlyIncomeExpenseChart />
    </PageLayout>
  );
}
