"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { sortByAmountDescending } from "../../lib/amount-order";
import { CHART_INITIAL_DIMENSION } from "../../lib/chart";
import { getChartColorArray } from "../../lib/colors";
import { formatCurrency, formatPercent } from "../../lib/format";
import { cn } from "../../lib/cn";
import { chartTooltipStyle } from "../charts/chart-tooltip";
import { AmountDisplay, getAmountColorClass } from "../ui/amount-display";
import { CardContent } from "../ui/card";
import { Pagination } from "../ui/pagination";
import {
  type GainFilter,
  matchesGainFilter,
  useHoldingsFilter,
} from "./unrealized-gain-card.client";

const PAGE_SIZE = 10;

interface HoldingItem {
  id: number;
  name: string;
  accountName: string | null;
  institution: string | null;
  categoryName: string | null;
  amount: number | null;
  unrealizedGain: number | null;
  unrealizedGainPct: number | null;
  dailyChange: number | null;
  avgCostPrice: number | null;
  quantity: number | null;
  unitPrice: number | null;
}

export interface CategoryGroup {
  category: string;
  items: HoldingItem[];
  total: number;
}

interface HoldingsTableClientProps {
  categories: CategoryGroup[];
  enableSharedFilter?: boolean;
}

function sortCategoryGroups(categories: readonly CategoryGroup[]): CategoryGroup[] {
  return sortByAmountDescending(
    categories.map((group) => ({
      ...group,
      items: sortByAmountDescending(
        group.items,
        (item) => item.amount,
        (item) => `${item.name}\u0000${item.id}`,
      ),
    })),
    (group) => group.total,
    (group) => group.category,
  );
}

function matchesInstitutionFilter(item: HoldingItem, selectedFilter?: string): boolean {
  if (!selectedFilter || selectedFilter === "__all__") return true;

  const [institution, categoryName] = selectedFilter.split("|");
  return (
    item.institution === institution &&
    (categoryName === undefined || item.categoryName === categoryName)
  );
}

export function filterCategories(
  categories: CategoryGroup[],
  selectedFilter?: string,
  gainFilter: GainFilter = "all",
) {
  return sortCategoryGroups(
    categories
      .map((group) => {
        const items = group.items.filter(
          (item) =>
            matchesInstitutionFilter(item, selectedFilter) &&
            matchesGainFilter(item.unrealizedGain, gainFilter),
        );
        return {
          ...group,
          items,
          total: items.reduce((sum, item) => sum + (item.amount ?? 0), 0),
        };
      })
      .filter((group) => group.items.length > 0),
  );
}

export function HoldingsTableTotal({
  categories,
  total,
  enableSharedFilter = false,
}: {
  categories: CategoryGroup[];
  total: number;
  enableSharedFilter?: boolean;
}) {
  const filter = useHoldingsFilter();
  const filteredCategories = filterCategories(
    categories,
    enableSharedFilter ? filter?.selectedFilter : undefined,
    enableSharedFilter ? filter?.gainFilter : undefined,
  );
  const hasActiveSharedFilter =
    enableSharedFilter &&
    filter !== null &&
    (filter.selectedFilter !== "__all__" || filter.gainFilter !== "all");
  const filteredTotal = hasActiveSharedFilter
    ? filteredCategories.reduce((sum, category) => sum + category.total, 0)
    : total;

  return <AmountDisplay amount={filteredTotal} size="lg" weight="bold" />;
}

export function HoldingsTableClient({
  categories,
  enableSharedFilter = false,
}: HoldingsTableClientProps) {
  const filter = useHoldingsFilter();
  const filteredCategories = filterCategories(
    categories,
    enableSharedFilter ? filter?.selectedFilter : undefined,
    enableSharedFilter ? filter?.gainFilter : undefined,
  );

  return (
    <CardContent className="space-y-4">
      {filteredCategories.length === 0 && (
        <p className="text-center py-4 text-muted-foreground text-sm">
          フィルター条件に一致する資産がありません
        </p>
      )}
      {filteredCategories.map(({ category, items, total: categoryTotal }) => (
        <CategoryCard
          key={category}
          category={category}
          items={items}
          categoryTotal={categoryTotal}
        />
      ))}
    </CardContent>
  );
}

function CategoryCard({
  category,
  items,
  categoryTotal,
}: {
  category: string;
  items: HoldingItem[];
  categoryTotal: number;
}) {
  const [currentPage, setCurrentPage] = useState(0);
  const scrollTargetRef = useRef<HTMLDivElement>(null);
  const totalPages = Math.ceil(items.length / PAGE_SIZE);
  const lastPage = Math.max(0, totalPages - 1);
  const visiblePage = Math.min(currentPage, lastPage);

  useEffect(() => {
    if (currentPage > lastPage) {
      setCurrentPage(lastPage);
    }
  }, [currentPage, lastPage]);

  // Colors are generated for all items (for chart consistency)
  const colors = getChartColorArray(items.length);

  const chartData = items.map((item, i) => ({
    name: item.name,
    value: item.amount || 0,
    color: colors[i],
  }));

  // Paginate items for the list display
  const startIndex = visiblePage * PAGE_SIZE;
  const paginatedItems = items.slice(startIndex, startIndex + PAGE_SIZE);

  return (
    <div
      ref={scrollTargetRef}
      className="rounded-lg border border-border overflow-hidden scroll-mt-20"
    >
      {/* Category header */}
      <div className="flex flex-col gap-0.5 px-4 py-2.5 bg-muted/50 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-foreground">{category}</span>
          <span className="text-sm text-muted-foreground">({items.length}件)</span>
        </div>
        <AmountDisplay amount={categoryTotal} weight="bold" />
      </div>

      {/* Chart + Legend area */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-6 p-4">
        {/* Donut chart */}
        <div className="w-56 h-56 shrink-0 self-center sm:self-auto">
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={CHART_INITIAL_DIMENSION}
          >
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                dataKey="value"
                strokeWidth={0}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => formatCurrency(value as number)}
                contentStyle={chartTooltipStyle}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Holdings list */}
        <div className="flex-1 min-w-0">
          <div className="space-y-3 mb-4">
            {paginatedItems.map((holding, i) => {
              const originalIndex = startIndex + i;
              const ratio = categoryTotal > 0 ? ((holding.amount || 0) / categoryTotal) * 100 : 0;

              return (
                <HoldingRow
                  key={holding.id}
                  holding={holding}
                  color={colors[originalIndex]}
                  ratio={ratio}
                />
              );
            })}
          </div>

          {/* Pagination */}
          <Pagination
            currentPage={visiblePage}
            totalPages={totalPages}
            pageSize={PAGE_SIZE}
            totalItems={items.length}
            onPageChange={setCurrentPage}
            scrollTargetRef={scrollTargetRef}
          />
        </div>
      </div>
    </div>
  );
}

function HoldingRow({
  holding,
  color,
  ratio,
}: {
  holding: HoldingItem;
  color: string;
  ratio: number;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const hasMainDetails =
    holding.unrealizedGain !== null ||
    holding.unrealizedGainPct !== null ||
    holding.dailyChange !== null;

  // 展開時に表示するコンテンツがあるかどうかで判定
  const hasExpandableContent =
    holding.avgCostPrice !== null ||
    holding.unitPrice !== null ||
    holding.quantity !== null ||
    holding.accountName !== null;

  const isClickable = hasExpandableContent;

  return (
    <div className="text-sm">
      {/* Main row */}
      {isClickable ? (
        <button
          type="button"
          className="flex items-center gap-2 w-full text-left cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
          />
          <span className="font-medium flex-1 min-w-0 truncate">{holding.name}</span>
          <div className="flex items-center gap-1 shrink-0">
            <div className="text-right tabular-nums">
              {holding.amount ? (
                <AmountDisplay
                  amount={holding.amount}
                  weight="semibold"
                  percentage={ratio}
                  percentageDecimals={1}
                  fixedWidth
                  percentageClassName="hidden sm:inline-block"
                />
              ) : (
                "-"
              )}
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                isExpanded && "rotate-180",
              )}
            />
          </div>
        </button>
      ) : (
        <div className="flex items-center gap-2 w-full">
          <div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
          />
          <span className="font-medium flex-1 min-w-0 truncate">{holding.name}</span>
          <div className="flex items-center gap-1 shrink-0">
            <div className="text-right tabular-nums">
              {holding.amount ? (
                <AmountDisplay
                  amount={holding.amount}
                  weight="semibold"
                  percentage={ratio}
                  percentageDecimals={1}
                  fixedWidth
                  percentageClassName="hidden sm:inline-block"
                />
              ) : (
                "-"
              )}
            </div>
          </div>
        </div>
      )}

      {/* Details row (daily change / unrealized gain) */}
      {hasMainDetails && !isExpanded && (
        <div className="flex items-center justify-end gap-3 mt-0.5 tabular-nums">
          {holding.dailyChange !== null && (
            <AmountDisplay
              amount={holding.dailyChange}
              type="balance"
              showSign
              size="sm"
              className="text-xs"
            />
          )}
          {holding.unrealizedGain !== null && (
            <AmountDisplay
              amount={holding.unrealizedGain}
              type="balance"
              showSign
              size="sm"
              className="text-xs"
              percentage={holding.unrealizedGainPct ?? undefined}
            />
          )}
        </div>
      )}

      {/* Expanded content */}
      {isExpanded && (
        <div className="mt-2 ml-4 space-y-1 border-l-2 border-muted pl-3 text-muted-foreground">
          {holding.accountName !== null && <p>口座: {holding.accountName}</p>}
          {holding.avgCostPrice !== null && (
            <p className="tabular-nums">取得単価: {formatCurrency(holding.avgCostPrice)}</p>
          )}
          {holding.unitPrice !== null && (
            <p className="tabular-nums">単価: {formatCurrency(holding.unitPrice)}</p>
          )}
          {holding.quantity !== null && (
            <p className="tabular-nums">数量: {holding.quantity.toLocaleString("ja-JP")}</p>
          )}
          {holding.unrealizedGain !== null && (
            <p className="tabular-nums">
              含み損益:{" "}
              <span
                className={getAmountColorClass({
                  value: holding.unrealizedGain,
                  type: "balance",
                })}
              >
                {formatCurrency(holding.unrealizedGain)}
                {holding.unrealizedGainPct !== null &&
                  ` (${formatPercent(holding.unrealizedGainPct)})`}
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
