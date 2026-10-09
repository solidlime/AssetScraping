/**
 * MCP サーバー（read-only）。
 * transport は MCP_TRANSPORT 環境変数で切り替える（デフォルト stdio = 後方互換）。
 * - stdio: StdioServerTransport（Claude Desktop 等のローカル起動用）
 * - http : Streamable HTTP（/mcp エンドポイント、Docker 常駐サーバー用）
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveDbPath } from "@asset-scraping/db";
import { createMcpServer } from "./server.ts";

const transportMode = process.env.MCP_TRANSPORT ?? "stdio";

async function startStdio(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
  // ログは stdout（MCP プロトコル）を塞がないよう stderr へ
  console.error(`[mcp] asset-scraping MCP ready (stdio, db=${resolveDbPath()})`);
}

async function startHttp(): Promise<void> {
  const { createServer } = await import("node:http");
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );

  const port = Number(process.env.PORT ?? 26280);
  const host = process.env.BIND ?? "0.0.0.0";

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    // stateless モード（sessionIdGenerator: undefined）を選択。
    // 理由: このサーバーは read-only ツールのみでセッション状態を持たず、
    // dbTool もリクエストごとに DB を open/close するため、
    // セッションごとの transport 管理よりリクエストごとの新規 transport が単純でリークもない。
    // SDK の stateless モードは 1 transport = 1 リクエスト限定のため、
    // POST ごとに新しい McpServer + transport を生成する（公式 stateless パターン）。
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        void transport.close();
      });
      const server = createMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
      return;
    }

    // GET（SSE）/ DELETE: stateless ではセッションを持たないため非対応。
    // 405 + allow で伝える（Streamable HTTP 仕様上も server-initiated SSE / 明示的
    // session 解除はオプションで、tools-only の本サーバーでは不要）。
    res.writeHead(405, { allow: "POST" });
    res.end();
  });

  httpServer.listen(port, host, () => {
    // HTTP モードでは stdout を塞ぐ心配がないためそのまま出す
    console.log(`[mcp] asset-scraping MCP listening on http://${host}:${port}/mcp (db=${resolveDbPath()})`);
  });
}

async function main(): Promise<void> {
  if (transportMode === "http") {
    await startHttp();
  } else {
    await startStdio();
  }
}

main().catch((err) => {
  console.error("[mcp] failed:", err);
  process.exit(1);
});
