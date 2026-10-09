"use client";

import { ArrowUpDown, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { extractRanking } from "../../lib/aggregation";
import { AmountDisplay } from "../ui/amount-display";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

interface HoldingData {
  name: string;
  code: string | null;
  categoryName: string | null;
  accountName: string | null;
  dailyChange: number;
}

interface DailyChangeCardClientProps {
  holdings: HoldingData[];
}

const RANKING_COUNT = 5;

export function DailyChangeCardClient({ holdings }: DailyChangeCardClientProps) {
  const { topGainers, topLosers, totalChange } = useMemo(
    () => extractRanking(holdings, RANKING_COUNT),
    [holdings],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle icon={ArrowUpDown}>前日比ランキング</CardTitle>
          <div className="text-sm">
            <span className="text-muted-foreground mr-2">合計</span>
            <AmountDisplay
              amount={totalChange}
              type={totalChange !== 0 ? "balance" : "neutral"}
              showSign={totalChange > 0}
              size="sm"
              weight="bold"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Top gainers */}
          <div>
            <p className="text-sm font-bold mb-3 flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5 text-balance-positive" />
              上昇
            </p>
            {topGainers.length > 0 ? (
              <div className="space-y-2">
                {topGainers.map((h, i) => (
                  <div
                    key={`${h.name}-${i}`}
                    className="flex items-center justify-between text-sm gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-muted-foreground shrink-0 w-4">{i + 1}.</span>
                      <span className="truncate">{h.name}</span>
                    </div>
                    <AmountDisplay
                      amount={h.dailyChange}
                      type="balance"
                      showSign
                      size="sm"
                      className="shrink-0"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">上昇銘柄なし</p>
            )}
          </div>

          {/* Top losers */}
          <div>
            <p className="text-sm font-bold mb-3 flex items-center gap-1">
              <TrendingDown className="h-3.5 w-3.5 text-balance-negative" />
              下落
            </p>
            {topLosers.length > 0 ? (
              <div className="space-y-2">
                {topLosers.map((h, i) => (
                  <div
                    key={`${h.name}-${i}`}
                    className="flex items-center justify-between text-sm gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-muted-foreground shrink-0 w-4">{i + 1}.</span>
                      <span className="truncate">{h.name}</span>
                    </div>
                    <AmountDisplay
                      amount={h.dailyChange}
                      type="balance"
                      size="sm"
                      className="shrink-0"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">下落銘柄なし</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
