import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describeTable, listTables, queryD1 } from "./tools/d1";
import type { Bindings } from "./types";

export function createMcpServer(env: Bindings): McpServer {
  const server = new McpServer({
    name: "mcp-cloudflare",
    version: "1.0.0",
  });

  server.tool("d1-list-tables", "List all tables in the D1 database", async () => ({
    content: [{ type: "text", text: JSON.stringify(await listTables(env.DB), null, 2) }],
  }));

  server.tool(
    "d1-describe",
    "Get schema information for a D1 table",
    { table: z.string().describe("Table name to describe") },
    async ({ table }) => ({
      content: [
        { type: "text", text: JSON.stringify(await describeTable(env.DB, table), null, 2) },
      ],
    })
  );

  server.tool(
    "d1-query",
    "Execute a SQL query against the D1 database",
    {
      sql: z.string().describe("SQL query to execute"),
      params: z.array(z.unknown()).optional().describe("Query parameters for prepared statement"),
    },
    async ({ sql, params }) => ({
      content: [
        { type: "text", text: JSON.stringify(await queryD1(env.DB, sql, params), null, 2) },
      ],
    })
  );

  return server;
}
