import { getShortMonth } from "../../lib/format";
import { AmountDisplay } from "../ui/amount-display";
import { Card, CardContent } from "../ui/card";
import { MetricLabel } from "../ui/metric-label";

interface MonthlySummaryCardProps {
  month: string;
  totalIncome: number;
  totalExpense: number;
  href?: string;
}

export function MonthlySummaryCard({
  month,
  totalIncome,
  totalExpense,
  href,
}: MonthlySummaryCardProps) {
  const balance = totalIncome - totalExpense;
  const expenseRatio =
    totalIncome > 0
      ? Math.min((totalExpense / totalIncome) * 100, 100)
      : totalExpense > 0
        ? 100
        : 0;
  const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : null;

  return (
    <Card href={href} className="border-primary/30 hover:border-primary transition-colors">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-foreground">{getShortMonth(month)}</span>
          <AmountDisplay
            amount={balance}
            type="balance"
            size="sm"
            weight="bold"
            percentage={savingsRate ?? undefined}
            percentageDecimals={0}
          />
        </div>
        {/* Expense ratio bar: expense / income */}
        <div className="h-1.5 rounded-full bg-balance-positive overflow-hidden mb-3 opacity-50">
          <div
            className="h-full bg-expense rounded-full transition-all"
            style={{ width: `${expenseRatio}%` }}
          />
        </div>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <MetricLabel title="収入" />
            <AmountDisplay amount={totalIncome} type="income" size="sm" />
          </div>
          <div className="flex justify-between">
            <MetricLabel title="支出" />
            <AmountDisplay amount={totalExpense} type="expense" size="sm" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
