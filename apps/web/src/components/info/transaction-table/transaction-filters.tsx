import { Search, X } from "lucide-react";
import { FilterBadges } from "../../ui/filter-badges";
import { Input } from "../../ui/input";
import { MultiSelectFilter } from "../../ui/multi-select-filter";

interface TransactionFiltersProps {
  searchText: string;
  selectedCategories: string[];
  selectedTypes: string[];
  selectedAccounts: string[];
  selectedDate: string | null;
  categories: string[];
  categoryCount: Map<string, number>;
  accounts: string[];
  accountCount: Map<string, number>;
  typeOptions: string[];
  onSearchChange: (value: string) => void;
  onCategoriesChange: (categories: string[]) => void;
  onTypesChange: (types: string[]) => void;
  onAccountsChange: (accounts: string[]) => void;
  onRemoveCategory: (category: string) => void;
  onRemoveType: (type: string) => void;
  onRemoveAccount: (account: string) => void;
  onRemoveDate: () => void;
  onClearAll: () => void;
}

export function TransactionFilters({
  searchText,
  selectedCategories,
  selectedTypes,
  selectedAccounts,
  selectedDate,
  categories,
  categoryCount,
  accounts,
  accountCount,
  typeOptions,
  onSearchChange,
  onCategoriesChange,
  onTypesChange,
  onAccountsChange,
  onRemoveCategory,
  onRemoveType,
  onRemoveAccount,
  onRemoveDate,
  onClearAll,
}: TransactionFiltersProps) {
  const categoryLabel = (category: string) => {
    const count = categoryCount.get(category) ?? 0;
    return `${category}(${count})`;
  };

  const typeLabel = (type: string) => {
    switch (type) {
      case "income":
        return "収入";
      case "expense":
        return "支出";
      case "transfer":
        return "振替";
      default:
        return type;
    }
  };

  const accountLabel = (account: string) => {
    const count = accountCount.get(account) ?? 0;
    return `${account}(${count})`;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="検索..."
            value={searchText}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 pr-9"
          />
          {searchText && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <MultiSelectFilter
          label="カテゴリー"
          options={categories}
          selected={selectedCategories}
          onChange={onCategoriesChange}
          getLabel={categoryLabel}
        />
        <MultiSelectFilter
          label="種別"
          options={typeOptions}
          selected={selectedTypes}
          onChange={onTypesChange}
          getLabel={typeLabel}
        />
        <MultiSelectFilter
          label="金融機関"
          options={accounts}
          selected={selectedAccounts}
          onChange={onAccountsChange}
          getLabel={accountLabel}
        />
      </div>
      <FilterBadges
        selectedCategories={selectedCategories}
        selectedTypes={selectedTypes}
        selectedAccounts={selectedAccounts}
        selectedDate={selectedDate}
        onRemoveCategory={onRemoveCategory}
        onRemoveType={onRemoveType}
        onRemoveAccount={onRemoveAccount}
        onRemoveDate={onRemoveDate}
        onClearAll={onClearAll}
      />
    </div>
  );
}
