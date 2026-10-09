import { X } from "lucide-react";
import { getCategoryColor } from "../../lib/colors";
import { formatDate } from "../../lib/format";
import { Badge } from "./badge";
import { Button } from "./button";

interface FilterBadgesProps {
  selectedCategories: string[];
  selectedTypes: string[];
  selectedAccounts?: string[];
  selectedDate?: string | null;
  onRemoveCategory: (category: string) => void;
  onRemoveType: (type: string) => void;
  onRemoveAccount?: (account: string) => void;
  onRemoveDate?: () => void;
  onClearAll: () => void;
}

const TYPE_CONFIG: Record<
  string,
  { label: string; variant: "success" | "destructive" | "outline" }
> = {
  income: { label: "収入", variant: "success" },
  expense: { label: "支出", variant: "destructive" },
  transfer: { label: "振替", variant: "outline" },
};

export function FilterBadges({
  selectedCategories,
  selectedTypes,
  selectedAccounts = [],
  selectedDate,
  onRemoveCategory,
  onRemoveType,
  onRemoveAccount,
  onRemoveDate,
  onClearAll,
}: FilterBadgesProps) {
  const hasFilters =
    selectedCategories.length > 0 ||
    selectedTypes.length > 0 ||
    selectedAccounts.length > 0 ||
    !!selectedDate;

  if (!hasFilters) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {selectedDate && (
        <Badge variant="secondary" className="gap-1">
          <span className="font-normal">日付:</span>
          {formatDate(selectedDate)}
          <button
            type="button"
            onClick={onRemoveDate}
            className="ml-1 hover:text-destructive"
            aria-label="日付フィルタを削除"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}
      {selectedCategories.map((category) => (
        <Badge
          key={category}
          style={{
            backgroundColor: `color-mix(in srgb, ${getCategoryColor(category)} 15%, transparent)`,
            borderColor: getCategoryColor(category),
          }}
          className="gap-1 border text-foreground"
        >
          <span className="font-normal">カテゴリー:</span>
          {category}
          <button
            type="button"
            onClick={() => onRemoveCategory(category)}
            className="ml-1 hover:text-foreground/60"
            aria-label={`${category}を削除`}
          >
            <X className="h-3 w-3 cursor-pointer" />
          </button>
        </Badge>
      ))}
      {selectedTypes.map((type) => {
        const config = TYPE_CONFIG[type] ?? {
          label: type,
          variant: "outline" as const,
        };
        return (
          <Badge key={type} variant={config.variant} className="gap-1">
            <span className="font-normal">種別:</span>
            {config.label}
            <button
              type="button"
              onClick={() => onRemoveType(type)}
              className="ml-1 hover:text-destructive"
              aria-label={`${config.label}を削除`}
            >
              <X className="h-3 w-3 cursor-pointer" />
            </button>
          </Badge>
        );
      })}
      {selectedAccounts.map((account) => (
        <Badge key={account} variant="secondary" className="gap-1">
          <span className="font-normal">金融機関:</span>
          {account}
          <button
            type="button"
            onClick={() => onRemoveAccount?.(account)}
            className="ml-1 hover:text-destructive"
            aria-label={`${account}を削除`}
          >
            <X className="h-3 w-3 cursor-pointer" />
          </button>
        </Badge>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="text-xs text-muted-foreground underline hover:text-foreground"
      >
        すべて解除
      </button>
    </div>
  );
}
