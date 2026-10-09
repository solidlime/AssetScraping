import { getHoldingsWithLatestValues } from "@asset-scraping/db";
import { Landmark as LandmarkIcon, PiggyBank as PiggyBankIcon } from "lucide-react";
import { sortByAmountDescending } from "../../lib/amount-order";
import { Card, CardHeader, CardTitle } from "../ui/card";
import { EmptyState } from "../ui/empty-state";
import { type CategoryGroup, HoldingsTableClient, HoldingsTableTotal } from "./holdings-table.client";

interface HoldingsTableProps {
  type: "asset" | "liability";
  className?: string;
  enableSharedFilter?: boolean;
}

const CONFIG = {
  asset: {
    title: "保有資産",
    icon: PiggyBankIcon,
  },
  liability: {
    title: "負債",
    icon: LandmarkIcon,
  },
} as const;

export async function HoldingsTable({ type, className, enableSharedFilter = false }: HoldingsTableProps) {
  const allHoldings = await getHoldingsWithLatestValues();
  const holdings = allHoldings.filter((h) => h.type === type && h.amount);

  const config = CONFIG[type];
  const Icon = config.icon;

  if (holdings.length === 0) {
    return <EmptyState icon={Icon} title={config.title} className={className} />;
  }

  const holdingsTotal = holdings.reduce((sum, holding) => sum + (holding.amount ?? 0), 0);

  // Group holdings by category
  const grouped = holdings.reduce<Record<string, CategoryGroup["items"]>>((acc, holding) => {
    const category =
      holding.type === "liability"
        ? holding.liabilityCategory || "その他"
        : holding.categoryName || "その他";
    acc[category] ??= [];
    acc[category].push({
      id: holding.id,
      name: holding.name,
      accountName: holding.accountName,
      institution: holding.institution,
      categoryName: holding.categoryName,
      amount: holding.amount,
      unrealizedGain: holding.unrealizedGain,
      unrealizedGainPct: holding.unrealizedGainPct,
      dailyChange: holding.dailyChange,
      avgCostPrice: holding.avgCostPrice,
      quantity: holding.quantity,
      unitPrice: holding.unitPrice,
    });
    return acc;
  }, {});

  const orderedCategories = sortByAmountDescending(
    Object.entries(grouped).map(([category, items]) => ({
      category,
      items: sortByAmountDescending(
        items,
        (item) => item.amount,
        (item) => `${item.name}\u0000${item.id}`,
      ),
      total: items.reduce((sum, h) => sum + (h.amount ?? 0), 0),
    })),
    (category) => category.total,
    (category) => category.category,
  );

  return (
    <div className={className}>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle icon={Icon}>{config.title}</CardTitle>
            <HoldingsTableTotal
              categories={orderedCategories}
              total={holdingsTotal}
              enableSharedFilter={enableSharedFilter}
            />
          </div>
        </CardHeader>
        <HoldingsTableClient
          categories={orderedCategories}
          enableSharedFilter={enableSharedFilter}
        />
      </Card>
    </div>
  );
}
