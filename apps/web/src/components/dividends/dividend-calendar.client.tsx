"use client";

import { CalendarDays } from "lucide-react";
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
import { formatCurrency, getShortMonth } from "../../lib/format";
import { ChartTooltipContent } from "../charts/chart-tooltip";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

interface DividendMonthBucket {
  month: string;
  amountJpy: number;
  confirmed: boolean;
}

interface DividendCalendarChartProps {
  months: DividendMonthBucket[];
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
}

function CalendarTooltip({ active, payload }: CalendarTooltipProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <ChartTooltipContent>
      <div className="space-y-1">
        <div className="font-semibold">{getShortMonth(point.month)}（{point.month.slice(0, 4)}年）</div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-muted-foreground">{point.isConfirmed ? "実績" : "推定（見込み）"}</span>
          <span className="tabular-nums">{formatCurrency(point.confirmed + point.estimated)}</span>
        </div>
      </div>
    </ChartTooltipContent>
  );
}

export function DividendCalendarChartClient({
  months,
  height = 350,
  className,
}: DividendCalendarChartProps) {
  const data = toChartData(months);

  return (
    <div className={className}>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle icon={CalendarDays}>12ヶ月カレンダー</CardTitle>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span
                  className="size-3 rounded-sm"
                  style={{ backgroundColor: semanticColors.income }}
                  aria-hidden
                />
                実績
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="size-3 rounded-sm border"
                  style={{
                    backgroundColor: "var(--color-muted)",
                    backgroundImage:
                      "repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 4px)",
                  }}
                  aria-hidden
                />
                推定（見込み）
              </span>
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
              <Tooltip content={<CalendarTooltip />} />
              <Bar dataKey="confirmed" name="実績" stackId="a" fill={semanticColors.income} />
              <Bar
                dataKey="estimated"
                name="推定（見込み）"
                stackId="a"
                fill="url(#dividend-estimated-pattern)"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
