import {
  getAssetBreakdownByCategory,
  getLiabilityBreakdownByCategory,
  getLatestTotalAssets,
} from "@asset-scraping/db";
import { Scale } from "lucide-react";
import { EmptyState } from "../ui/empty-state";
import { BalanceSheetChartClient } from "./balance-sheet-chart.client";

interface BalanceSheetChartProps {
  className?: string;
}

export async function BalanceSheetChart({ className }: BalanceSheetChartProps) {
  const assets = await getAssetBreakdownByCategory();
  const liabilities = await getLiabilityBreakdownByCategory();
  const totalAssets = await getLatestTotalAssets();

  if (totalAssets === null) {
    return <EmptyState icon={Scale} title="バランスシート" className={className} />;
  }

  const totalLiabilities = liabilities.reduce((sum, l) => sum + l.amount, 0);
  const netAssets = totalAssets - totalLiabilities;

  return (
    <BalanceSheetChartClient
      assets={assets}
      liabilities={liabilities}
      netAssets={netAssets}
      totalAssets={totalAssets}
      className={className}
    />
  );
}
