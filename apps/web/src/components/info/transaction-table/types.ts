export interface Transaction {
  id: number;
  date: string;
  category: string | null;
  /** 必須にして mapper の写し漏れを tsc で捕まえる（null は SSNB 同様に空表示） */
  subCategory: string | null;
  description: string | null;
  amount: number;
  type: string;
  isTransfer: boolean | null;
  isExcludedFromCalculation: boolean | null;
  accountName: string | null;
  /** 口座の金融機関名（accounts.institution）。行ごとの /cf「保有金融機関」ではないので全行同じ値になる */
  institution?: string | null;
  transferTarget?: string | null;
}

export type SortColumn = "date" | "description" | "category" | "type" | "amount" | "accountName";

export interface TransactionKpi {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  count: number;
  medianExpense: number;
}
