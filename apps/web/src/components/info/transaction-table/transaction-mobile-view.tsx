import { getCategoryColor } from "../../../lib/colors";
import { formatDate } from "../../../lib/format";
import { cn } from "../../../lib/cn";
import { AmountDisplay } from "../../ui/amount-display";
import { Badge } from "../../ui/badge";
import { EmptyState } from "../../ui/empty-state";
import { TypeBadge } from "../../ui/type-badge";
import type { Transaction } from "./types";

interface TransactionMobileViewProps {
  transactions: Transaction[];
}

export function TransactionMobileView({ transactions }: TransactionMobileViewProps) {
  return (
    <section className="md:hidden space-y-3" aria-label="取引一覧">
      {transactions.length > 0 ? (
        transactions.map((transaction) => (
          <div
            key={transaction.id}
            className={cn("rounded-lg border p-3", transaction.isTransfer && "bg-muted/30")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">
                {formatDate(transaction.date)}
              </span>
              <TypeBadge type={transaction.type} isTransfer={transaction.isTransfer} />
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {transaction.description || "-"}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <Badge
                    style={{
                      backgroundColor: `color-mix(in srgb, ${getCategoryColor(transaction.category ?? "振替")} 15%, transparent)`,
                      borderColor: getCategoryColor(transaction.category ?? "振替"),
                    }}
                    className="border text-foreground"
                  >
                    {transaction.category ?? "振替"}
                  </Badge>
                  {transaction.accountName && (
                    <span className="text-xs text-muted-foreground">
                      {transaction.accountName}
                    </span>
                  )}
                </div>
              </div>
              <AmountDisplay
                amount={transaction.amount}
                type={
                  transaction.type === "income"
                    ? "income"
                    : transaction.type === "expense"
                      ? "expense"
                      : "neutral"
                }
                className={cn("shrink-0", transaction.isTransfer && "text-transfer")}
              />
            </div>
          </div>
        ))
      ) : (
        <EmptyState message="取引が見つかりません" />
      )}
    </section>
  );
}
