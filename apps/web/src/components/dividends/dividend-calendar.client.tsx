"use client";

import type { DividendMonthBucket } from "@asset-scraping/db";
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_INITIAL_DIMENSION } from "../../lib/chart";
import { semanticColors } from "../../lib/colors";
import { formatCurrency, formatMonth, getShortMonth } from "../../lib/format";
import { ChartTooltipContent } from "../charts/chart-tooltip";
import { AmountDisplay } from "../ui/amount-display";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { PeriodToggle } from "../ui/period-toggle";

/** 推定（見込み）の凡例・内訳マーカー。色だけでなく斜線でも区別する。 */
const ESTIMATED_SWATCH_STYLE = {
  backgroundColor: "var(--color-muted)",
  backgroundImage: "repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 4px)",
} as const;

type DividendBasis = "exDate" | "payout";

const BASIS_OPTIONS: Array<{ value: DividendBasis; label: string }> = [
  { value: "exDate", label: "配当落ち" },
  { value: "payout", label: "入金（推定）" },
];

interface DividendCalendarChartProps {
  months: DividendMonthBucket[];
  payoutMonths: DividendMonthBucket[];
  height?: number;
  className?: string;
}

interface CalendarPoint {
  label: string;
  month: string;
  confirmed: number;
  estimated: number;
  isConfirmed: boolean;
}

function toChartData(months: DividendMonthBucket[]): CalendarPoint[] {
  return months.map((m) => ({
    label: `${m.month.slice(2, 4)}/${Number(m.month.slice(5, 7))}`,
    month: m.month,
    confirmed: m.confirmed ? m.amountJpy : 0,
    estimated: m.confirmed ? 0 : m.amountJpy,
    isConfirmed: m.confirmed,
  }));
}

interface CalendarTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: CalendarPoint }>;
  basis: DividendBasis;
}

function CalendarTooltip({ active, payload, basis }: CalendarTooltipProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const confirmedLabel = basis === "payout" ? "確定（配当落ち済み）" : "確定（配当落ち）";
  return (
    <ChartTooltipContent>
      <div className="space-y-1">
        <div className="font-semibold">{getShortMonth(point.month)}（{point.month.slice(0, 4)}年）</div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-muted-foreground">
            {point.isConfirmed ? confirmedLabel : "推定（見込み）"}
          </span>
          <span className="tabular-nums">{formatCurrency(point.confirmed + point.estimated)}</span>
        </div>
      </div>
    </ChartTooltipContent>
  );
}

/** 選択月の銘柄内訳（上位5件＋「他N件」）。 */
function MonthBreakdown({ bucket }: { bucket: DividendMonthBucket }) {
  if (bucket.byHolding.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">内訳データがありません</p>;
  }
  const shown = bucket.byHolding.slice(0, 5);
  const rest = bucket.byHolding.slice(5);
  const restTotal = rest.reduce((sum, slice) => sum + slice.amountJpy, 0);
  return (
    <>
      <ul className="mt-2 space-y-1 text-sm">
        {shown.map((slice) => (
          <li key={slice.holdingName} className="flex items-center justify-between gap-4">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-3 shrink-0 rounded-sm"
                style={
                  slice.confirmed
                    ? { backgroundColor: semanticColors.income }
                    : ESTIMATED_SWATCH_STYLE
                }
                aria-hidden
              />
              <span className="truncate">{slice.holdingName}</span>
              <Badge variant={slice.confirmed ? "secondary" : "outline"}>
                {slice.confirmed ? "確定" : "推定"}
              </Badge>
            </span>
            <AmountDisplay amount={slice.amountJpy} size="sm" />
          </li>
        ))}
        {rest.length > 0 && (
          <li className="flex items-center justify-between gap-4 text-muted-foreground">
            <span>他{rest.length}件</span>
            <AmountDisplay amount={restTotal} size="sm" />
          </li>
        )}
      </ul>
      <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm">
        <span className="font-semibold">合計</span>
        <AmountDisplay amount={bucket.amountJpy} size="sm" weight="semibold" />
      </div>
    </>
  );
}

export function DividendCalendarChartClient({
  months,
  payoutMonths,
  height = 350,
  className,
}: DividendCalendarChartProps) {
  const [basis, setBasis] = useState<DividendBasis>("exDate");
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const buckets = basis === "payout" ? payoutMonths : months;
  const data = toChartData(buckets);
  const selected = buckets.find((m) => m.month === selectedMonth) ?? null;

  const handleBarClick = (point: unknown) => {
    setSelectedMonth((point as CalendarPoint).month);
  };

  return (
    <div className={className}>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle icon={CalendarDays}>12ヶ月カレンダー</CardTitle>
            <div className="flex flex-wrap items-center gap-4">
              <PeriodToggle options={BASIS_OPTIONS} value={basis} onChange={setBasis} />
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-3 rounded-sm"
                    style={{ backgroundColor: semanticColors.income }}
                    aria-hidden
                  />
                  確定
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-3 rounded-sm border" style={ESTIMATED_SWATCH_STYLE} aria-hidden />
                  推定（見込み）
                </span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer
            width="100%"
            height={height}
            initialDimension={CHART_INITIAL_DIMENSION}
          >
            <ComposedChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <defs>
                {/* 推定は色だけでなく斜線パターンでも区別できるようにする */}
                <pattern
                  id="dividend-estimated-pattern"
                  width="6"
                  height="6"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width="6" height="6" fill="var(--color-muted)" />
                  <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-muted-foreground)" strokeWidth="1.5" />
                </pattern>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `${Math.round(value / 10000)}万`}
              />
              <Tooltip content={<CalendarTooltip basis={basis} />} />
              <Bar
                dataKey="confirmed"
                name="確定"
                stackId="a"
                fill={semanticColors.income}
                cursor="pointer"
                onClick={handleBarClick}
              />
              <Bar
                dataKey="estimated"
                name="推定（見込み）"
                stackId="a"
                fill="url(#dividend-estimated-pattern)"
                cursor="pointer"
                onClick={handleBarClick}
              />
            </ComposedChart>
          </ResponsiveContainer>

          {basis === "payout" && (
            <p className="mt-2 text-xs text-muted-foreground">
              ※ 入金日は推定です（日本株は配当落ち+3ヶ月、米国株は+1ヶ月）。
            </p>
          )}

          {selected && (
            <div className="mt-4 border-t pt-3">
              <div className="text-sm font-semibold">
                {formatMonth(selected.month)} の内訳
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {basis === "payout" ? "入金（推定）" : "配当落ち"}基準
                </span>
              </div>
              <MonthBreakdown bucket={selected} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
