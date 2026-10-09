/** 金額表示の色クラスロジック（本家 mf-dashboard の amount-display.tsx 準拠）。 */
import { cn } from "../../lib/cn";
import { formatCurrency, formatPercent } from "../../lib/format";

type AmountType = "income" | "expense" | "balance" | "neutral";

interface GetAmountColorClassOptions {
  value: number;
  type: AmountType;
  /** true: 正が赤、負が緑（支出の減少は良いこと） */
  inverse?: boolean;
}

export function getAmountColorClass({
  value,
  type,
  inverse = false,
}: GetAmountColorClassOptions): string | undefined {
  if (type === "income") return "text-income";
  if (type === "expense") return "text-expense";
  if (type === "balance") {
    const isPositive = value >= 0;
    if (inverse) {
      return isPositive ? "text-balance-negative" : "text-balance-positive";
    }
    return isPositive ? "text-balance-positive" : "text-balance-negative";
  }
  return undefined;
}

const sizeClasses = {
  sm: "text-sm",
  md: "",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
} as const;

const weightClasses = {
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
} as const;

interface AmountDisplayProps {
  amount: number;
  type?: AmountType;
  showSign?: boolean;
  showUnit?: boolean;
  inverse?: boolean;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  weight?: "medium" | "semibold" | "bold";
  percentage?: number;
  percentageDecimals?: number;
  fixedWidth?: boolean;
  percentageClassName?: string;
  className?: string;
}

function AmountDisplay({
  amount,
  type = "neutral",
  showSign = false,
  showUnit = true,
  inverse = false,
  size = "md",
  weight = "medium",
  percentage,
  percentageDecimals = 1,
  fixedWidth = false,
  percentageClassName,
  className,
}: AmountDisplayProps) {
  const colorClass = getAmountColorClass({ value: amount, type, inverse });

  const sign = showSign && amount > 0 ? "+" : "";

  const formattedAmount = showUnit ? formatCurrency(amount) : amount.toLocaleString("ja-JP");

  const percentageColorClass = type === "neutral" ? "text-muted-foreground" : colorClass;

  const amountContent = (
    <>
      {sign}
      {formattedAmount}
    </>
  );

  return (
    <span
      className={cn(
        "tabular-nums",
        sizeClasses[size],
        weightClasses[weight],
        colorClass,
        className,
      )}
    >
      {fixedWidth ? (
        <span className="inline-block min-w-28 text-right">{amountContent}</span>
      ) : (
        amountContent
      )}
      {percentage !== undefined && (
        <span
          className={cn(
            "ml-1 tabular-nums",
            fixedWidth && "inline-block min-w-14 text-right",
            percentageColorClass,
            percentageClassName,
          )}
        >
          {formatPercent(percentage, percentageDecimals)}
        </span>
      )}
    </span>
  );
}

export { AmountDisplay, type AmountType };
