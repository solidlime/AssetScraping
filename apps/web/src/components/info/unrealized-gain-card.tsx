import { getHoldingsWithLatestValues } from "@asset-scraping/db";
import { TrendingUp } from "lucide-react";
import { EmptyState } from "../ui/empty-state";
import { HoldingsFilterReset, UnrealizedGainCardClient } from "./unrealized-gain-card.client";

interface UnrealizedGainCardProps {
  className?: string;
}

export async function UnrealizedGainCard({ className }: UnrealizedGainCardProps) {
  const holdings = await getHoldingsWithLatestValues();
  const withGain = holdings.filter((h) => h.unrealizedGain !== null);

  if (withGain.length === 0) {
    return (
      <div className={className}>
        <HoldingsFilterReset />
        <EmptyState icon={TrendingUp} title="含み損益" />
      </div>
    );
  }

  const holdingsData = withGain.map((h) => ({
    name: h.name,
    amount: h.amount,
    unrealizedGain: h.unrealizedGain!,
    unrealizedGainPct: h.unrealizedGainPct,
    institution: h.institution,
    categoryName: h.categoryName,
  }));

  // 金融機関ごと、金融機関+種別ごとの保有額を集計
  const institutionTotals = new Map<string, number>();
  const institutionCategoryTotals = new Map<string, number>();

  for (const h of withGain) {
    if (h.institution) {
      institutionTotals.set(h.institution, (institutionTotals.get(h.institution) ?? 0) + h.amount);
      if (h.categoryName) {
        const key = `${h.institution}|${h.categoryName}`;
        institutionCategoryTotals.set(key, (institutionCategoryTotals.get(key) ?? 0) + h.amount);
      }
    }
  }

  // 保有額の多い順にソートした金融機関リスト
  const sortedInstitutions = [...institutionTotals.entries()].sort((a, b) => b[1] - a[1]);

  // フィルターオプションを生成: 金融機関 → 金融機関+種別 の順
  const filterOptions: { value: string; label: string }[] = [];
  for (const [inst] of sortedInstitutions) {
    filterOptions.push({ value: inst, label: inst });
    // この金融機関に属する種別を保有額順に追加
    const categoryEntries = [...institutionCategoryTotals.entries()]
      .filter(([key]) => key.startsWith(`${inst}|`))
      .sort((a, b) => b[1] - a[1]);
    for (const [key] of categoryEntries) {
      const categoryName = key.split("|")[1];
      filterOptions.push({ value: key, label: `${inst} - ${categoryName}` });
    }
  }

  return (
    <div className={className}>
      <UnrealizedGainCardClient holdings={holdingsData} filterOptions={filterOptions} />
    </div>
  );
}
