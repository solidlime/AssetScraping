import { getAssetHistoryWithCategories } from "@asset-scraping/db";
import { LineChart } from "lucide-react";
import { EmptyState } from "../ui/empty-state";
import { AssetHistoryChartClient } from "./asset-history-chart.client";

interface AssetHistoryChartProps {
  className?: string;
}

export async function AssetHistoryChart({ className }: AssetHistoryChartProps) {
  const data = (await getAssetHistoryWithCategories())
    .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date))
    .reverse();

  if (data.length === 0) {
    return <EmptyState icon={LineChart} title="資産推移" className={className} />;
  }

  return <AssetHistoryChartClient data={data} className={className} />;
}
