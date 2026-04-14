# SQL Editor Phase 1: MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** R2 Data Catalog の Iceberg テーブルに対して SQL クエリを実行し、結果を表示できる Web SQL エディターの MVP を構築する。

**Architecture:** Cloudflare Workers + Vite + React SPA で構築。Worker（Hono）が R2 SQL REST API へのプロキシとカタログ API を提供し、React フロントエンドで Monaco Editor + Kumo コンポーネントの UI を配信する。`@cloudflare/vite-plugin` でローカル開発とデプロイを統合。

**Tech Stack:** TypeScript, React, Vite, @cloudflare/vite-plugin, Hono, @cloudflare/kumo, Monaco Editor (@monaco-editor/react), Cloudflare Workers Static Assets

**Design Spec:** Linear TA-453

**Phases:**
- **Phase 1（このプラン）**: Worker API + React + Monaco Editor + 結果テーブル + サイドバー
- **Phase 2**: DuckDB WASM 統合
- **Phase 3**: PartyKit 共同編集

---

## File Structure

### 新規作成

```
sql-editor/
├── index.html                    # Vite エントリ HTML
├── vite.config.ts                # Vite + Cloudflare plugin 設定
├── wrangler.jsonc                # Worker 設定（Static Assets + Secrets Store）
├── package.json                  # 依存関係
├── tsconfig.json                 # TypeScript 設定
├── biome.json                    # Biome 設定
├── worker/
│   ├── index.ts                  # Worker エントリ（Hono）
│   ├── types.ts                  # Worker 型定義（Env）
│   ├── api/
│   │   ├── query.ts              # POST /api/query — R2 SQL プロキシ
│   │   └── catalog.ts            # GET /api/tables, /api/describe — カタログ API
│   └── __tests__/
│       └── query.test.ts         # API テスト
├── src/
│   ├── main.tsx                  # React エントリ
│   ├── App.tsx                   # メインレイアウト
│   ├── components/
│   │   ├── Editor.tsx            # Monaco Editor ラッパー
│   │   ├── ResultPanel.tsx       # クエリ結果 + エラー表示
│   │   ├── Sidebar.tsx           # テーブル一覧 + スキーマ
│   │   └── Toolbar.tsx           # Run ボタン + ステータス
│   ├── hooks/
│   │   ├── useQuery.ts           # クエリ実行ロジック
│   │   └── useCatalog.ts         # テーブル一覧・スキーマ取得
│   └── lib/
│       └── api.ts                # fetch ラッパー
└── public/
    └── (empty, Vite handles assets)
```

---

## Task 1: プロジェクトスキャフォールド

**Files:**
- Create: `sql-editor/package.json`
- Create: `sql-editor/tsconfig.json`
- Create: `sql-editor/biome.json`
- Create: `sql-editor/vite.config.ts`
- Create: `sql-editor/wrangler.jsonc`
- Create: `sql-editor/index.html`

- [ ] **Step 1: `sql-editor/package.json` を作成**

```json
{
  "name": "sql-editor",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "deploy": "vite build && wrangler deploy",
    "typecheck": "tsc --noEmit",
    "lint": "biome lint .",
    "check": "biome check .",
    "check:fix": "biome check --write ."
  },
  "dependencies": {
    "@cloudflare/kumo": "latest",
    "@monaco-editor/react": "^4.7.0",
    "@phosphor-icons/react": "^2.1.0",
    "hono": "^4.11.7",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.11",
    "@cloudflare/vite-plugin": "^1.0.0",
    "@cloudflare/workers-types": "^4.20250124.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^4.4.0",
    "typescript": "^5.7.0",
    "vite": "^6.3.0",
    "wrangler": "^4.4.0"
  }
}
```

- [ ] **Step 2: `sql-editor/tsconfig.json` を作成**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["@cloudflare/workers-types/experimental", "vite/client"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "worker/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: `sql-editor/biome.json` を作成**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.11/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true,
    "root": ".."
  },
  "files": {
    "ignoreUnknown": true,
    "includes": ["**", "!**/node_modules", "!**/dist", "!**/.wrangler"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": { "noExplicitAny": "warn" },
      "complexity": { "noForEach": "off" }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "es5"
    }
  },
  "assist": { "actions": { "source": { "organizeImports": "on" } } }
}
```

- [ ] **Step 4: `sql-editor/vite.config.ts` を作成**

```typescript
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), cloudflare()],
});
```

- [ ] **Step 5: `sql-editor/wrangler.jsonc` を作成**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "sql-editor",
  "main": "worker/index.ts",
  "compatibility_date": "2026-04-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  },
  "assets": {
    "not_found_handling": "single-page-application"
  },
  "secrets_store_secrets": [
    {
      "binding": "R2_SQL_TOKEN",
      "store_id": "16dbae494da74139a51c1b15d7a7e6d1",
      "secret_name": "R2_SQL_TOKEN"
    }
  ]
}
```

- [ ] **Step 6: `sql-editor/index.html` を作成**

```html
<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SQL Editor</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: 依存関係をインストール**

Run: `cd sql-editor && pnpm install`

- [ ] **Step 8: コミット**

```bash
git add sql-editor/package.json sql-editor/pnpm-lock.yaml sql-editor/tsconfig.json sql-editor/biome.json sql-editor/vite.config.ts sql-editor/wrangler.jsonc sql-editor/index.html
git commit -m "chore: scaffold sql-editor project (Vite + React + Cloudflare)"
```

---

## Task 2: Worker API — R2 SQL プロキシ

**Files:**
- Create: `sql-editor/worker/types.ts`
- Create: `sql-editor/worker/api/query.ts`
- Create: `sql-editor/worker/api/catalog.ts`
- Create: `sql-editor/worker/index.ts`

- [ ] **Step 1: `sql-editor/worker/types.ts` を作成**

```typescript
export interface SecretStoreSecret {
  get(): Promise<string | null>;
}

export interface Env {
  R2_SQL_TOKEN: SecretStoreSecret;
  ASSETS: Fetcher;
}

export const R2_SQL_ACCOUNT_ID = "b0047256d1afc1be1df08289ee3be552";
export const R2_SQL_WAREHOUSE = "b0047256d1afc1be1df08289ee3be552_lake";
```

- [ ] **Step 2: `sql-editor/worker/api/query.ts` を作成**

```typescript
import { Hono } from "hono";
import type { Env } from "../types";
import { R2_SQL_ACCOUNT_ID, R2_SQL_WAREHOUSE } from "../types";

const query = new Hono<{ Bindings: Env }>();

query.post("/", async (c) => {
  const body = await c.req.json<{ query: string }>();
  if (!body.query) {
    return c.json({ error: "Query is required" }, 400);
  }

  const token = await c.env.R2_SQL_TOKEN.get();
  if (!token) {
    return c.json({ error: "R2 SQL token not configured" }, 500);
  }

  const r2SqlUrl = `https://api.sql.cloudflarestorage.com/api/v1/accounts/${R2_SQL_ACCOUNT_ID}/r2-sql/query/${R2_SQL_WAREHOUSE}`;

  const startTime = Date.now();

  const response = await fetch(r2SqlUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: body.query }),
  });

  const elapsed = Date.now() - startTime;

  if (!response.ok) {
    const errorText = await response.text();
    return c.json(
      {
        error: errorText,
        status: response.status,
        elapsed,
        engine: "r2sql",
      },
      response.status as 400 | 401 | 403 | 500
    );
  }

  const data = await response.json();
  return c.json({
    ...data,
    elapsed,
    engine: "r2sql",
  });
});

export default query;
```

- [ ] **Step 3: `sql-editor/worker/api/catalog.ts` を作成**

```typescript
import { Hono } from "hono";
import type { Env } from "../types";
import { R2_SQL_ACCOUNT_ID, R2_SQL_WAREHOUSE } from "../types";

const catalog = new Hono<{ Bindings: Env }>();

async function executeR2Sql(token: string, sql: string) {
  const r2SqlUrl = `https://api.sql.cloudflarestorage.com/api/v1/accounts/${R2_SQL_ACCOUNT_ID}/r2-sql/query/${R2_SQL_WAREHOUSE}`;
  const response = await fetch(r2SqlUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) {
    throw new Error(`R2 SQL error: ${response.status}`);
  }
  return response.json();
}

catalog.get("/tables", async (c) => {
  const token = await c.env.R2_SQL_TOKEN.get();
  if (!token) {
    return c.json({ error: "R2 SQL token not configured" }, 500);
  }

  const namespaces = await executeR2Sql(token, "SHOW NAMESPACES");
  const tables: { namespace: string; table: string }[] = [];

  for (const ns of namespaces.data ?? []) {
    const nsName = Object.values(ns)[0] as string;
    const tblResult = await executeR2Sql(token, `SHOW TABLES IN ${nsName}`);
    for (const tbl of tblResult.data ?? []) {
      tables.push({
        namespace: nsName,
        table: Object.values(tbl)[0] as string,
      });
    }
  }

  return c.json({ tables });
});

catalog.get("/describe/:namespace/:table", async (c) => {
  const { namespace, table } = c.req.param();
  const token = await c.env.R2_SQL_TOKEN.get();
  if (!token) {
    return c.json({ error: "R2 SQL token not configured" }, 500);
  }

  const result = await executeR2Sql(token, `DESCRIBE ${namespace}.${table}`);
  return c.json(result);
});

export default catalog;
```

- [ ] **Step 4: `sql-editor/worker/index.ts` を作成**

```typescript
import { Hono } from "hono";
import type { Env } from "./types";
import catalog from "./api/catalog";
import query from "./api/query";

const app = new Hono<{ Bindings: Env }>();

app.route("/api/query", query);
app.route("/api/catalog", catalog);

app.get("/api/health", (c) => c.json({ status: "ok" }));

export default app;
```

- [ ] **Step 5: コミット**

```bash
git add sql-editor/worker/
git commit -m "feat: add Worker API for R2 SQL proxy and catalog"
```

---

## Task 3: React エントリ + メインレイアウト

**Files:**
- Create: `sql-editor/src/main.tsx`
- Create: `sql-editor/src/App.tsx`
- Create: `sql-editor/src/lib/api.ts`

- [ ] **Step 1: `sql-editor/src/lib/api.ts` を作成**

```typescript
const BASE_URL = "/api";

export async function executeQuery(sql: string): Promise<QueryResult> {
  const response = await fetch(`${BASE_URL}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  return response.json();
}

export async function fetchTables(): Promise<TablesResult> {
  const response = await fetch(`${BASE_URL}/catalog/tables`);
  return response.json();
}

export async function describeTable(
  namespace: string,
  table: string
): Promise<DescribeResult> {
  const response = await fetch(`${BASE_URL}/catalog/describe/${namespace}/${table}`);
  return response.json();
}

export interface QueryResult {
  data?: Record<string, unknown>[];
  columns?: string[];
  error?: string;
  elapsed?: number;
  engine?: string;
  status?: number;
}

export interface TablesResult {
  tables: { namespace: string; table: string }[];
  error?: string;
}

export interface DescribeResult {
  data?: Record<string, unknown>[];
  error?: string;
}
```

- [ ] **Step 2: `sql-editor/src/main.tsx` を作成**

```tsx
import "@cloudflare/kumo/styles";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
```

- [ ] **Step 3: `sql-editor/src/App.tsx` を作成**

```tsx
import { useState } from "react";
import Editor from "./components/Editor";
import ResultPanel from "./components/ResultPanel";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import { useCatalog } from "./hooks/useCatalog";
import { useQuery } from "./hooks/useQuery";

export default function App() {
  const [sql, setSql] = useState(
    "-- R2 Data Catalog の Iceberg テーブルにクエリを実行できます\n-- 例: SELECT * FROM streaming.linear_events LIMIT 10\n-- Cmd+Enter で実行\n"
  );
  const { result, loading, execute } = useQuery();
  const { tables, loadingTables } = useCatalog();

  const handleRun = () => execute(sql);

  const handleInsert = (text: string) => {
    setSql((prev) => `${prev}${text}`);
  };

  return (
    <div style={{ display: "flex", height: "100vh", flexDirection: "column" }}>
      <header
        style={{
          padding: "8px 16px",
          borderBottom: "1px solid var(--color-border, #e5e7eb)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <strong>SQL Editor</strong>
        <span style={{ fontSize: "12px", color: "#888" }}>R2 Data Catalog</span>
      </header>
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Sidebar
          tables={tables}
          loading={loadingTables}
          onInsert={handleInsert}
        />
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            <Editor value={sql} onChange={setSql} onRun={handleRun} />
          </div>
          <Toolbar loading={loading} onRun={handleRun} result={result} />
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <ResultPanel result={result} loading={loading} />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: コミット**

```bash
git add sql-editor/src/main.tsx sql-editor/src/App.tsx sql-editor/src/lib/api.ts
git commit -m "feat: add React entry point and main layout"
```

---

## Task 4: hooks — useQuery + useCatalog

**Files:**
- Create: `sql-editor/src/hooks/useQuery.ts`
- Create: `sql-editor/src/hooks/useCatalog.ts`

- [ ] **Step 1: `sql-editor/src/hooks/useQuery.ts` を作成**

```typescript
import { useCallback, useState } from "react";
import { type QueryResult, executeQuery } from "../lib/api";

export function useQuery() {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);

  const execute = useCallback(async (sql: string) => {
    setLoading(true);
    setResult(null);
    try {
      const data = await executeQuery(sql);
      setResult(data);
    } catch (err) {
      setResult({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  return { result, loading, execute };
}
```

- [ ] **Step 2: `sql-editor/src/hooks/useCatalog.ts` を作成**

```typescript
import { useCallback, useEffect, useState } from "react";
import {
  type DescribeResult,
  type TablesResult,
  describeTable,
  fetchTables,
} from "../lib/api";

export interface TableInfo {
  namespace: string;
  table: string;
  columns?: DescribeResult["data"];
}

export function useCatalog() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loadingTables, setLoadingTables] = useState(true);

  useEffect(() => {
    fetchTables()
      .then((res: TablesResult) => {
        setTables(res.tables?.map((t) => ({ ...t })) ?? []);
      })
      .catch(() => setTables([]))
      .finally(() => setLoadingTables(false));
  }, []);

  const loadColumns = useCallback(
    async (namespace: string, table: string) => {
      const res = await describeTable(namespace, table);
      setTables((prev) =>
        prev.map((t) =>
          t.namespace === namespace && t.table === table
            ? { ...t, columns: res.data }
            : t
        )
      );
    },
    []
  );

  return { tables, loadingTables, loadColumns };
}
```

- [ ] **Step 3: コミット**

```bash
git add sql-editor/src/hooks/
git commit -m "feat: add useQuery and useCatalog hooks"
```

---

## Task 5: Monaco Editor コンポーネント

**Files:**
- Create: `sql-editor/src/components/Editor.tsx`

- [ ] **Step 1: `sql-editor/src/components/Editor.tsx` を作成**

```tsx
import MonacoEditor from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useCallback, useRef } from "react";

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
}

export default function Editor({ value, onChange, onRun }: EditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleMount = useCallback(
    (editor: editor.IStandaloneCodeEditor) => {
      editorRef.current = editor;
      // Cmd/Ctrl + Enter でクエリ実行
      editor.addAction({
        id: "run-query",
        label: "Run Query",
        keybindings: [
          // Monaco KeyMod.CtrlCmd | Monaco KeyCode.Enter
          2048 | 3,
        ],
        run: () => onRun(),
      });
    },
    [onRun]
  );

  return (
    <MonacoEditor
      height="100%"
      language="sql"
      theme="vs-light"
      value={value}
      onChange={(v) => onChange(v ?? "")}
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        wordWrap: "on",
        padding: { top: 12 },
        automaticLayout: true,
      }}
    />
  );
}
```

- [ ] **Step 2: コミット**

```bash
git add sql-editor/src/components/Editor.tsx
git commit -m "feat: add Monaco Editor component with Cmd+Enter shortcut"
```

---

## Task 6: ResultPanel コンポーネント

**Files:**
- Create: `sql-editor/src/components/ResultPanel.tsx`

- [ ] **Step 1: `sql-editor/src/components/ResultPanel.tsx` を作成**

```tsx
import type { QueryResult } from "../lib/api";

interface ResultPanelProps {
  result: QueryResult | null;
  loading: boolean;
}

export default function ResultPanel({ result, loading }: ResultPanelProps) {
  if (loading) {
    return (
      <div style={{ padding: 16, color: "#888" }}>
        クエリを実行中...
      </div>
    );
  }

  if (!result) {
    return (
      <div style={{ padding: 16, color: "#888" }}>
        Cmd+Enter または Run ボタンでクエリを実行
      </div>
    );
  }

  if (result.error) {
    return (
      <div style={{ padding: 16 }}>
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 6,
            padding: 12,
          }}
        >
          <div style={{ fontWeight: 600, color: "#dc2626", marginBottom: 4 }}>
            Query Error {result.engine ? `· ${result.engine}` : ""}
          </div>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              fontSize: 13,
              color: "#991b1b",
            }}
          >
            {result.error}
          </pre>
        </div>
      </div>
    );
  }

  const rows = result.data ?? [];
  if (rows.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ color: "#16a34a", fontWeight: 600, marginBottom: 8 }}>
          ✅ 0 rows · {result.elapsed}ms · {result.engine}
        </div>
        <div style={{ color: "#888" }}>クエリは成功しましたが、結果は0件です。</div>
      </div>
    );
  }

  const columns = Object.keys(rows[0]);

  return (
    <div style={{ padding: "8px 16px" }}>
      <div
        style={{
          marginBottom: 8,
          color: "#16a34a",
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        ✅ {rows.length} rows · {result.elapsed}ms · {result.engine}
      </div>
      <div style={{ overflow: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  padding: "6px 12px",
                  borderBottom: "2px solid #e5e7eb",
                  textAlign: "left",
                  fontWeight: 600,
                  color: "#374151",
                  position: "sticky",
                  top: 0,
                  background: "white",
                }}
              >
                #
              </th>
              {columns.map((col) => (
                <th
                  key={col}
                  style={{
                    padding: "6px 12px",
                    borderBottom: "2px solid #e5e7eb",
                    textAlign: "left",
                    fontWeight: 600,
                    color: "#374151",
                    position: "sticky",
                    top: 0,
                    background: "white",
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={`row-${i}`}
                style={{ borderBottom: "1px solid #f3f4f6" }}
              >
                <td
                  style={{
                    padding: "6px 12px",
                    color: "#9ca3af",
                  }}
                >
                  {i + 1}
                </td>
                {columns.map((col) => (
                  <td
                    key={col}
                    style={{
                      padding: "6px 12px",
                      maxWidth: 300,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {renderCell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
```

- [ ] **Step 2: コミット**

```bash
git add sql-editor/src/components/ResultPanel.tsx
git commit -m "feat: add ResultPanel with table display and error handling"
```

---

## Task 7: Sidebar コンポーネント

**Files:**
- Create: `sql-editor/src/components/Sidebar.tsx`

- [ ] **Step 1: `sql-editor/src/components/Sidebar.tsx` を作成**

```tsx
import type { TableInfo } from "../hooks/useCatalog";

interface SidebarProps {
  tables: TableInfo[];
  loading: boolean;
  onInsert: (text: string) => void;
}

export default function Sidebar({ tables, loading, onInsert }: SidebarProps) {
  const grouped = tables.reduce<Record<string, TableInfo[]>>((acc, t) => {
    (acc[t.namespace] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div
      style={{
        width: 240,
        borderRight: "1px solid #e5e7eb",
        overflow: "auto",
        padding: "12px 0",
        fontSize: 13,
      }}
    >
      <div
        style={{
          padding: "0 12px 8px",
          fontWeight: 600,
          color: "#374151",
        }}
      >
        Tables
      </div>
      {loading ? (
        <div style={{ padding: "0 12px", color: "#888" }}>Loading...</div>
      ) : (
        Object.entries(grouped).map(([ns, tbls]) => (
          <div key={ns} style={{ marginBottom: 8 }}>
            <div
              style={{
                padding: "4px 12px",
                fontWeight: 600,
                color: "#6b7280",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {ns}
            </div>
            {tbls.map((t) => (
              <button
                type="button"
                key={`${t.namespace}.${t.table}`}
                onClick={() => onInsert(`${t.namespace}.${t.table}`)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "4px 12px 4px 20px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#1f2937",
                  fontSize: 13,
                }}
                title={`Click to insert ${t.namespace}.${t.table}`}
              >
                {t.table}
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: コミット**

```bash
git add sql-editor/src/components/Sidebar.tsx
git commit -m "feat: add Sidebar with table list grouped by namespace"
```

---

## Task 8: Toolbar コンポーネント

**Files:**
- Create: `sql-editor/src/components/Toolbar.tsx`

- [ ] **Step 1: `sql-editor/src/components/Toolbar.tsx` を作成**

```tsx
import type { QueryResult } from "../lib/api";

interface ToolbarProps {
  loading: boolean;
  onRun: () => void;
  result: QueryResult | null;
}

export default function Toolbar({ loading, onRun, result }: ToolbarProps) {
  return (
    <div
      style={{
        padding: "6px 16px",
        borderTop: "1px solid #e5e7eb",
        borderBottom: "1px solid #e5e7eb",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <button
        type="button"
        onClick={onRun}
        disabled={loading}
        style={{
          padding: "4px 16px",
          background: loading ? "#9ca3af" : "#2563eb",
          color: "white",
          border: "none",
          borderRadius: 4,
          cursor: loading ? "not-allowed" : "pointer",
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        {loading ? "Running..." : "▶ Run (R2 SQL)"}
      </button>
      <span style={{ fontSize: 12, color: "#888" }}>Cmd+Enter</span>
      {result?.elapsed && (
        <span style={{ fontSize: 12, color: "#888", marginLeft: "auto" }}>
          {result.elapsed}ms
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: コミット**

```bash
git add sql-editor/src/components/Toolbar.tsx
git commit -m "feat: add Toolbar with Run button"
```

---

## Task 9: ローカル動作確認 + Secrets Store 設定

- [ ] **Step 1: R2_SQL_TOKEN を Secrets Store に登録**

```bash
npx wrangler secrets-store secret create 16dbae494da74139a51c1b15d7a7e6d1 \
  --name R2_SQL_TOKEN \
  --scopes workers \
  --remote
# → プロンプトで R2 Catalog Token の値を入力
```

- [ ] **Step 2: ローカル開発用の .dev.vars を作成**

Create `sql-editor/.dev.vars`:
```
R2_SQL_TOKEN=cfat_your_token_here
```

Add to `.gitignore` if not already ignored.

- [ ] **Step 3: ローカルで起動**

Run: `cd sql-editor && pnpm dev`
Expected: Vite dev server が起動し、ブラウザで SQL エディターが表示される

- [ ] **Step 4: ヘルスチェック**

Open: `http://localhost:5173/api/health`
Expected: `{"status":"ok"}`

- [ ] **Step 5: SQL クエリ実行テスト**

Monaco Editor に以下を入力して Cmd+Enter:
```sql
SELECT action, type, created_at FROM streaming.linear_events LIMIT 5
```
Expected: 結果テーブルにデータが表示される

- [ ] **Step 6: コミット（.dev.vars は除外）**

```bash
git add sql-editor/
git commit -m "feat: sql-editor Phase 1 MVP complete"
```

---

## Task 10: デプロイ + E2E 確認

- [ ] **Step 1: デプロイ**

Run: `cd sql-editor && pnpm deploy`
Expected: Worker + Static Assets がデプロイされ URL が返される

- [ ] **Step 2: ブラウザで確認**

Open: `https://sql-editor.ta93abe.workers.dev`
Expected: SQL エディターが表示される

- [ ] **Step 3: クエリ実行**

Enter and run:
```sql
SELECT action, type, created_at, data FROM streaming.linear_events LIMIT 10
```
Expected: 結果テーブルにデータが表示される

- [ ] **Step 4: サイドバー確認**

Expected: サイドバーに `streaming > linear_events` が表示される
