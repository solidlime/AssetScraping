export interface Transaction {
  id: number;
  date: string;
  category: string | null;
  description: string | null;
  amount: number;
  type: string;
  isTransfer: boolean | null;
  isExcludedFromCalculation: boolean | null;
  accountName: string | null;
}

export type SortColumn = "date" | "description" | "category" | "type" | "amount" | "accountName";

export interface TransactionKpi {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  count: number;
  medianExpense: number;
}
