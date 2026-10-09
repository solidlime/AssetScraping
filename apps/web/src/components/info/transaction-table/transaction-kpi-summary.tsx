import { AmountDisplay } from "../../ui/amount-display";
import { MetricLabel } from "../../ui/metric-label";
import type { TransactionKpi } from "./types";

interface TransactionKpiSummaryProps {
  kpi: TransactionKpi;
}

export function TransactionKpiSummary({ kpi }: TransactionKpiSummaryProps) {
  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
      <div className="rounded-lg border bg-background p-3">
        <MetricLabel title="合計収入" />
        <p className="mt-0.5">
          <AmountDisplay amount={kpi.totalIncome} type="income" size="lg" weight="bold" />
        </p>
      </div>
      <div className="rounded-lg border bg-background p-3">
        <MetricLabel title="合計支出" />
        <p className="mt-0.5">
          <AmountDisplay amount={kpi.totalExpense} type="expense" size="lg" weight="bold" />
        </p>
      </div>
      <div className="rounded-lg border bg-background p-3">
        <MetricLabel title="収支" />
        <p className="mt-0.5">
          <AmountDisplay amount={kpi.balance} type="balance" size="lg" weight="bold" />
        </p>
      </div>
      <div className="rounded-lg border bg-background p-3">
        <MetricLabel title="支出中央値" />
        <p className="mt-0.5">
          <AmountDisplay amount={kpi.medianExpense} type="expense" size="lg" weight="bold" />
        </p>
      </div>
    </div>
  );
}
