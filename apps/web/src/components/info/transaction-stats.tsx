import { getMfTransactions } from "@asset-scraping/db";
import { PieChart as PieChartIcon } from "lucide-react";
import { EmptyState } from "../ui/empty-state";
import { createBreakdowns, type BreakdownTransaction } from "./transaction-stats-utils";
import { TransactionStatsClient } from "./transaction-stats.client";

interface TransactionStatsProps {
  year: string;
}

export async function TransactionStats({ year }: TransactionStatsProps) {
  const allTransactions = await getMfTransactions();
  const transactions = allTransactions.filter((t) => t.date.substring(0, 4) === year);

  // Filter out excluded transactions and transfers (for expense)
  const validTransactions = transactions.filter(
    (t) => !t.isExcludedFromCalculation && !t.isTransfer,
  );

  if (validTransactions.length === 0) {
    return <EmptyState icon={PieChartIcon} title="カテゴリ別内訳" />;
  }

  // Category breakdown for expenses (by large category) and income (by sub-category)
  const expenseCategoryMap = new Map<string, number>();
  const incomeSubCategoryMap = new Map<string, number>();

  for (const t of validTransactions) {
    if (t.type === "expense") {
      const category = t.category ?? "その他";
      expenseCategoryMap.set(category, (expenseCategoryMap.get(category) ?? 0) + t.amount);
    } else if (t.type === "income") {
      // Use sub-category for income (since large category is mostly just "収入")
      const subCategory = t.subCategory ?? "その他";
      incomeSubCategoryMap.set(
        subCategory,
        (incomeSubCategoryMap.get(subCategory) ?? 0) + t.amount,
      );
    }
  }

  const expenseCategories = Array.from(expenseCategoryMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const incomeCategories = Array.from(incomeSubCategoryMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // db 層の type は nullable — null は振替扱いで既に除外済みのため非 null として扱う
  // SAFETY: validTransactions は isTransfer=false のみで、type が null の行は振替なので除外される
  const typedTransactions: BreakdownTransaction[] = validTransactions.flatMap((t) =>
    t.type === null ? [] : [t as BreakdownTransaction],
  );

  return (
    <TransactionStatsClient
      year={year}
      income={createBreakdowns(incomeCategories, "income", typedTransactions)}
      expense={createBreakdowns(expenseCategories, "expense", typedTransactions)}
    />
  );
}
