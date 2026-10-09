import { ChevronRight } from "lucide-react";
import { formatDateShort } from "../../../lib/format";
import { cn } from "../../../lib/cn";
import { AmountDisplay } from "../../ui/amount-display";
import type { SubCategoryData } from "./types";

interface SubCategoryAccordionProps {
  subCategory: SubCategoryData;
  categoryAmount: number;
  type: "income" | "expense";
  isExpanded: boolean;
  onToggle: () => void;
}

export function SubCategoryAccordion({
  subCategory,
  categoryAmount,
  type,
  isExpanded,
  onToggle,
}: SubCategoryAccordionProps) {
  const subPercentage = categoryAmount > 0 ? (subCategory.amount / categoryAmount) * 100 : 0;
  const hasTransactions = subCategory.transactions.length > 0;

  return (
    <div className="space-y-1">
      <button
        type="button"
        className={cn(
          "w-full text-left flex items-center justify-between text-sm py-1",
          hasTransactions && "cursor-pointer",
        )}
        onClick={(e) => {
          e.stopPropagation();
          if (hasTransactions) onToggle();
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {hasTransactions && (
            <ChevronRight
              className={cn(
                "h-3 w-3 text-muted-foreground transition-transform shrink-0",
                isExpanded && "rotate-90",
              )}
            />
          )}
          <span className="font-medium truncate">{subCategory.subCategory}</span>
          <span className="text-muted-foreground shrink-0">({subPercentage.toFixed(0)}%)</span>
        </div>
        <AmountDisplay
          amount={subCategory.amount}
          type={type}
          size="sm"
          className="shrink-0 ml-2"
        />
      </button>

      {/* Transaction list */}
      {hasTransactions && isExpanded && (
        <div className="ml-5 space-y-1 border-l pl-3 border-muted/50">
          {subCategory.transactions.map((tx, idx) => (
            <div
              key={`${tx.date}-${tx.description}-${idx}`}
              className="flex items-center justify-between text-sm text-muted-foreground py-0.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="shrink-0">{formatDateShort(tx.date)}</span>
                <span className="truncate">{tx.description}</span>
              </div>
              <AmountDisplay amount={tx.amount} type={type} size="sm" className="shrink-0 ml-2" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
