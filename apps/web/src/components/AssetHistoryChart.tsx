"use client";

import {
  AreaChart,
  Area,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { formatYen } from "@/lib/format";

export interface AssetHistorySeriesPoint {
  date: string;
  [category: string]: number | string;
}

/**
 * 資産推移チャート（recharts、カテゴリ積み上げ）。
 * Client Component なので props はシリアライズ可能な値のみ。
 */
export function AssetHistoryChart({ data }: { data: AssetHistorySeriesPoint[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        データがありません。スクレイプを実行してください。
      </p>
    );
  }

  const categories = Object.keys(data[0] ?? {}).filter((k) => k !== "date");

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
          <XAxis dataKey="date" fontSize={12} />
          <YAxis
            fontSize={12}
            tickFormatter={(v: number) => `${(v / 10_000).toLocaleString("ja-JP")}万`}
            width={72}
          />
          <Tooltip formatter={(v) => formatYen(Number(v))} />
          <Legend />
          {categories.map((cat) => (
            <Area
              key={cat}
              type="monotone"
              dataKey={cat}
              stackId="1"
              stroke="#2563eb"
              fill="#3b82f6"
              fillOpacity={0.4}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
