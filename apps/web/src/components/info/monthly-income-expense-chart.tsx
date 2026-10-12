import { getMonthlySummaries } from "@asset-scraping/db";
import { TrendingUp } from "lucide-react";
import { MonthlyIncomeExpenseChartClient } from "../charts/lazy-charts.client";
import { EmptyState } from "../ui/empty-state";

interface MonthlyIncomeExpenseChartProps {
  className?: string;
}

export async function MonthlyIncomeExpenseChart({ className }: MonthlyIncomeExpenseChartProps) {
  const data = await getMonthlySummaries({ limit: 12 });

  if (data.length === 0) {
    return <EmptyState icon={TrendingUp} title="月別収支推移" className={className} />;
  }

  return <MonthlyIncomeExpenseChartClient data={data} className={className} />;
}
