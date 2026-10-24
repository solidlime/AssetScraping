/**
 * MCP サーバー定義（read-only）。
 * ツール: get_accounts / get_transactions / get_holdings / get_asset_history / get_monthly_summary
 * DB は read-only 接続。更新トリガーは持たない（web UI に一元化）。
 * stdio / HTTP 両 transport から使うため、インスタンス生成を関数化している。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getAccountAlerts,
  getAllAccountStatuses,
  getAllAccounts,
  getAssetHistory,
  getFinancialMetrics,
  getHoldings,
  getMonthlySummary,
  getTransactions,
} from "@asset-scraping/db";
import { dbTool } from "./tools.ts";

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "asset-scraping", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.tool("get_accounts", "ssnb の口座一覧と現在残高を取得する", {}, () =>
    dbTool((db) => {
      const accounts = getAllAccounts(db);
      const statuses = new Map(getAllAccountStatuses(db).map((s) => [s.accountId, s]));
      return accounts.map((a) => ({
        id: a.id,
        name: a.name,
        institution: a.institution,
        category: a.category,
        balance: statuses.get(a.id)?.balance ?? null,
        scrapedAt: statuses.get(a.id)?.scrapedAt ?? null,
      }));
    }),
  );

  server.tool(
    "get_transactions",
    "取引履歴を取得する（limit / since で絞り込み）",
    {
      limit: z.number().int().min(1).max(1000).default(100).describe("最大件数"),
      since: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("この日付以降 (YYYY-MM-DD)"),
    },
    ({ limit, since }) => dbTool((db) => getTransactions(db, { limit, since })),
  );

  server.tool(
    "get_holdings",
    "保有資産（銘柄・数量・評価額・含み損益）を取得する",
    {
      accountId: z.string().optional().describe("口座 ID で絞り込み"),
    },
    ({ accountId }) => dbTool((db) => getHoldings(db, accountId)),
  );

  server.tool(
    "get_asset_history",
    "資産推移（日次 × カテゴリ別）を取得する",
    {
      since: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("この日付以降 (YYYY-MM-DD)"),
    },
    ({ since }) => dbTool((db) => getAssetHistory(db, { since })),
  );

  server.tool(
    "get_monthly_summary",
    "月次収支サマリー（収入・支出・収支）を取得する",
    {
      months: z.number().int().min(1).max(60).default(12).describe("直近 N ヶ月"),
    },
    ({ months }) => dbTool((db) => getMonthlySummary(db, { months })),
  );

  server.tool(
    "get_account_alerts",
    "口座警告（低残高・異常ステータス・クレカ引き落としの残高不足）を取得する",
    {
      threshold: z.number().int().min(0).optional().describe("低残高しきい値（円）。省略時は DB 設定"),
      withdrawal_alert_days: z
        .number()
        .int()
        .min(1)
        .max(30)
        .optional()
        .describe("引き落とし日まで何日以内なら警告するか（1〜30）。省略時は DB 設定（既定 7）"),
      withdrawal_account_id: z
        .string()
        .optional()
        .describe(
          "引き落とし口座の口座 ID。省略時は DB 設定。未設定なら銀行口座が1つだけのときにそれを、複数なら警告しない",
        ),
    },
    ({ threshold, withdrawal_alert_days, withdrawal_account_id }) =>
      dbTool((db) =>
        getAccountAlerts(db, {
          threshold,
          withdrawalAlertDays: withdrawal_alert_days,
          withdrawalAccountId: withdrawal_account_id,
        }),
      ),
  );

  server.tool(
    "get_financial_metrics",
    "財務メトリクス（貯蓄・投資・支出・成長・残高・負債・健全性スコア）を取得する",
    {},
    () => dbTool((db) => getFinancialMetrics(undefined, db)),
  );

  return server;
}
