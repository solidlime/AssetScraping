import type { getHoldingsByAccountId } from "@asset-scraping/db";
import { PiggyBank } from "lucide-react";
import { AmountDisplay, getAmountColorClass } from "../../../components/ui/amount-display";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { EmptyState } from "../../../components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { formatNumber, formatPercent } from "../../../lib/format";

type HoldingRow = Awaited<ReturnType<typeof getHoldingsByAccountId>>[number];

/**
 * 口座詳細の保有資産一覧。`/bs` と同じ `getHoldingsByAccountId` の行を
 * 銘柄名 / 数量 / 評価額 / 含み損益 / 評価損益率 / カテゴリ で表示する。
 */
export function AccountHoldingsTable({ holdings }: { holdings: HoldingRow[] }) {
  if (holdings.length === 0) {
    return <EmptyState icon={PiggyBank} title="保有資産" message="保有資産はありません" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={PiggyBank}>保有資産</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>銘柄名</TableHead>
              <TableHead className="text-right">数量</TableHead>
              <TableHead className="text-right">評価額</TableHead>
              <TableHead className="text-right">含み損益</TableHead>
              <TableHead className="text-right">評価損益率</TableHead>
              <TableHead>カテゴリ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {holdings.map((holding) => (
              <TableRow key={holding.id}>
                <TableCell className="font-medium">{holding.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {holding.quantity != null ? formatNumber(holding.quantity) : "-"}
                </TableCell>
                <TableCell className="text-right">
                  <AmountDisplay amount={holding.amount ?? 0} />
                </TableCell>
                <TableCell className="text-right">
                  {holding.unrealizedGain != null ? (
                    <AmountDisplay amount={holding.unrealizedGain} type="balance" showSign />
                  ) : (
                    "-"
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {holding.unrealizedGainPct != null ? (
                    <span
                      className={getAmountColorClass({
                        value: holding.unrealizedGainPct,
                        type: "balance",
                      })}
                    >
                      {formatPercent(holding.unrealizedGainPct)}
                    </span>
                  ) : (
                    "-"
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{holding.categoryName ?? "未分類"}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
