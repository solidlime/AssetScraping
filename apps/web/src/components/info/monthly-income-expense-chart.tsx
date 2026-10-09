import { getMonthlySummaries } from "@asset-scraping/db";
import { TrendingUp } from "lucide-react";
import { EmptyState } from "../ui/empty-state";
import { MonthlyIncomeExpenseChartClient } from "./monthly-income-expense-chart.client";

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
