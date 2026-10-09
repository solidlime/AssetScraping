import { getMfTransactions, getTransactionsByMonth } from "@asset-scraping/db";
import { ListOrdered } from "lucide-react";
import { DateFilterProvider } from "../date-filter-context";
import { EmptyState } from "../../ui/empty-state";
import { TransactionTableClient } from "./transaction-table.client";

interface TransactionTableProps {
  month?: string;
  showYearSelector?: boolean;
}

/** db 層の行を UI 型へ変換。type が null（振替由来）の行は "transfer" として扱う。 */
function toUiTransactions(rows: Awaited<ReturnType<typeof getMfTransactions>>) {
  return rows.map((t) => ({
    id: t.id,
    date: t.date,
    category: t.category,
    description: t.description,
    amount: t.amount,
    type: t.type ?? "transfer",
    isTransfer: t.isTransfer,
    isExcludedFromCalculation: t.isExcludedFromCalculation,
    accountName: t.accountName,
  }));
}

export async function TransactionTable({ month, showYearSelector }: TransactionTableProps) {
  const transactions = month ? await getTransactionsByMonth(month) : await getMfTransactions();

  if (transactions.length === 0) {
    return <EmptyState icon={ListOrdered} title="詳細一覧" />;
  }

  return (
    <DateFilterProvider>
      <TransactionTableClient
        transactions={toUiTransactions(transactions)}
        isMonthView={!!month}
        showYearSelector={showYearSelector}
      />
    </DateFilterProvider>
  );
}
