import { getAssetBreakdownByCategory, getCategoryChangesForPeriod, getLatestTotalAssets, getLiabilityBreakdownByCategory } from "@asset-scraping/db";
import { PieChart } from "lucide-react";
import { EmptyState } from "../ui/empty-state";
import { AssetBreakdownChartClient } from "./asset-breakdown-chart.client";

interface AssetBreakdownChartProps {
  className?: string;
}

export async function AssetBreakdownChart({ className }: AssetBreakdownChartProps) {
  const data = await getAssetBreakdownByCategory();

  if (data.length === 0) {
    return <EmptyState icon={PieChart} title="資産構成" />;
  }

  const totalAssets = await getLatestTotalAssets();
  const liabilities = await getLiabilityBreakdownByCategory();
  const totalLiabilities = liabilities.reduce((sum, l) => sum + l.amount, 0);
  const netAssets = totalAssets !== null ? totalAssets - totalLiabilities : null;

  const dailyChanges = await getCategoryChangesForPeriod("daily");
  const weeklyChanges = await getCategoryChangesForPeriod("weekly");
  const monthlyChanges = await getCategoryChangesForPeriod("monthly");

  return (
    <AssetBreakdownChartClient
      data={data}
      dailyChanges={dailyChanges}
      weeklyChanges={weeklyChanges}
      monthlyChanges={monthlyChanges}
      netAssets={netAssets}
      className={className}
    />
  );
}
