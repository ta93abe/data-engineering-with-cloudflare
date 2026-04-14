# SQL Editor Phase 1.5: テーブル・カラム補完 + E2E テスト

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CodeMirror 6 のスキーマ補完を有効化し、テーブル名・カラム名のオートコンプリートを実装する。加えて Playwright E2E テストで主要な UI 操作のリグレッションを防止する。

**Architecture:** `useCatalog` hook が起動時にテーブル一覧を取得し、各テーブルの DESCRIBE 結果からスキーマオブジェクトを構築。CodeMirror の `Compartment` で `sql({ schema })` を動的に差し替える。E2E テストは Playwright で `pnpm dev` に対して実行。

**Tech Stack:** @codemirror/lang-sql (schema option), @codemirror/state (Compartment), @playwright/test, Vite dev server

---

## File Structure

### 変更

```
sql-editor/
├── src/
│   ├── App.tsx                    # useCatalog から schema を Editor に渡す
│   ├── components/
│   │   └── Editor.tsx             # Compartment でスキーマ補完を動的更新
│   └── hooks/
│       └── useCatalog.ts          # 全テーブルのカラムを自動取得、schema オブジェクト構築
```

### 新規作成

```
sql-editor/
├── e2e/
│   └── sql-editor.spec.ts        # Playwright E2E テストスイート
├── playwright.config.ts           # Playwright 設定
```

---

## Task 1: useCatalog でスキーマ自動取得

**Files:**
- Modify: `sql-editor/src/hooks/useCatalog.ts`
- Modify: `sql-editor/src/lib/api.ts` (DescribeResult の型を具体化)

- [ ] **Step 1: `api.ts` の `DescribeResult` 型を具体化**

`Record<string, unknown>[]` では型が曖昧なので、実際の DESCRIBE レスポンスに合わせる。

```typescript
// sql-editor/src/lib/api.ts — DescribeResult を以下に変更
export interface ColumnInfo {
  column_name: string;
  type: string;
  required: string;
}

export interface DescribeResult {
  data?: ColumnInfo[];
  error?: string;
}
```

- [ ] **Step 2: `useCatalog.ts` でスキーマオブジェクトを自動構築**

テーブル一覧取得後に、全テーブルの DESCRIBE を並列実行し、CodeMirror 用の `schema` オブジェクトを構築する。

```typescript
// sql-editor/src/hooks/useCatalog.ts — 全体を以下に置き換え
import { useEffect, useState } from "react";
import { type ColumnInfo, type TablesResult, describeTable, fetchTables } from "../lib/api";

export interface TableInfo {
  namespace: string;
  table: string;
  columns?: ColumnInfo[];
}

export type SqlSchema = Record<string, string[]>;

export function useCatalog() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [schema, setSchema] = useState<SqlSchema>({});
  const [loadingTables, setLoadingTables] = useState(true);

  useEffect(() => {
    fetchTables()
      .then(async (res: TablesResult) => {
        const list = res.tables ?? [];
        setTables(list.map((t) => ({ ...t })));

        const described = await Promise.all(
          list.map(async (t) => {
            const desc = await describeTable(t.namespace, t.table);
            return {
              fqn: `${t.namespace}.${t.table}`,
              columns: desc.data ?? [],
            };
          })
        );

        const newSchema: SqlSchema = {};
        const enriched: TableInfo[] = [];
        for (const d of described) {
          newSchema[d.fqn] = d.columns.map((c) => c.column_name);
          const [ns, tbl] = d.fqn.split(".");
          enriched.push({ namespace: ns, table: tbl, columns: d.columns });
        }
        setTables(enriched);
        setSchema(newSchema);
      })
      .catch(() => setTables([]))
      .finally(() => setLoadingTables(false));
  }, []);

  return { tables, schema, loadingTables };
}
```

- [ ] **Step 3: biome check + tsc**

Run: `cd sql-editor && pnpm exec biome check --write . && pnpm exec tsc -b`

- [ ] **Step 4: コミット**

```bash
git add sql-editor/src/lib/api.ts sql-editor/src/hooks/useCatalog.ts
git commit -m "feat: auto-fetch column schema for all tables in useCatalog"
```

---

## Task 2: Editor に Compartment でスキーマ補完を注入

**Files:**
- Modify: `sql-editor/src/components/Editor.tsx`
- Modify: `sql-editor/src/App.tsx`

- [ ] **Step 1: `Editor.tsx` に `schema` prop と `Compartment` を追加**

```typescript
// sql-editor/src/components/Editor.tsx — 全体を以下に置き換え
import { sql } from "@codemirror/lang-sql";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import type { SqlSchema } from "../hooks/useCatalog";

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  schema?: SqlSchema;
}

export default function Editor({ value, onChange, onRun, schema }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const sqlCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);

  onChangeRef.current = onChange;
  onRunRef.current = onRun;

  // biome-ignore lint/correctness/useExhaustiveDependencies: CodeMirror is imperative; value is only used for initial doc, subsequent syncs happen via the second useEffect
  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          sqlCompartment.current.of(sql()),
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                onRunRef.current();
                return true;
              },
            },
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
          EditorView.theme({
            "&": { height: "100%" },
            ".cm-scroller": { overflow: "auto" },
            ".cm-content": { padding: "12px 0" },
          }),
        ],
      }),
      parent: containerRef.current,
    });

    viewRef.current = view;
    return () => view.destroy();
  }, []);

  // Sync external value changes (e.g., sidebar insert)
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  }, [value]);

  // Update SQL schema when catalog data arrives
  useEffect(() => {
    const view = viewRef.current;
    if (view && schema && Object.keys(schema).length > 0) {
      view.dispatch({
        effects: sqlCompartment.current.reconfigure(sql({ schema })),
      });
    }
  }, [schema]);

  return <div ref={containerRef} style={{ height: "100%", overflow: "auto" }} />;
}
```

- [ ] **Step 2: `App.tsx` で `schema` を `Editor` に渡す**

`useCatalog` から `schema` を取得し、`Editor` コンポーネントに渡す。

```tsx
// sql-editor/src/App.tsx — useCatalog の呼び出しを変更
const { tables, schema, loadingTables } = useCatalog();

// Editor に schema prop を追加
<Editor value={sql} onChange={setSql} onRun={handleRun} schema={schema} />
```

- [ ] **Step 3: biome check + tsc**

Run: `cd sql-editor && pnpm exec biome check --write . && pnpm exec tsc -b`

- [ ] **Step 4: ローカルで動作確認**

Run: `cd sql-editor && pnpm dev`
確認: ブラウザで `SELECT ` と入力して Ctrl+Space → `__ingest_ts`, `action`, `type` 等のカラム名が補完候補に表示される。`FROM ` と入力 → `streaming.linear_events` が補完候補に表示される。

- [ ] **Step 5: コミット**

```bash
git add sql-editor/src/components/Editor.tsx sql-editor/src/App.tsx
git commit -m "feat: add schema-aware SQL autocomplete via Compartment"
```

---

## Task 3: Playwright E2E テスト環境セットアップ

**Files:**
- Modify: `sql-editor/package.json`
- Create: `sql-editor/playwright.config.ts`

- [ ] **Step 1: Playwright をインストール**

```bash
cd sql-editor && pnpm add -D @playwright/test
```

- [ ] **Step 2: ブラウザをインストール**

```bash
cd sql-editor && pnpm exec playwright install chromium
```

- [ ] **Step 3: `sql-editor/playwright.config.ts` を作成**

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
  },
  webServer: {
    command: "pnpm dev",
    port: 5173,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
```

- [ ] **Step 4: `package.json` に test:e2e スクリプトを追加**

```json
"test:e2e": "playwright test"
```

- [ ] **Step 5: コミット**

```bash
git add sql-editor/package.json sql-editor/pnpm-lock.yaml sql-editor/playwright.config.ts
git commit -m "chore: add Playwright E2E test setup"
```

---

## Task 4: E2E テスト — 基本操作

**Files:**
- Create: `sql-editor/e2e/sql-editor.spec.ts`

- [ ] **Step 1: テストファイルを作成**

```typescript
// sql-editor/e2e/sql-editor.spec.ts
import { expect, test } from "@playwright/test";

test.describe("SQL Editor", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // CodeMirror がマウントされるのを待つ
    await page.waitForSelector(".cm-editor");
  });

  test("エディターが表示され SQL を入力できる", async ({ page }) => {
    const editor = page.locator(".cm-editor");
    await expect(editor).toBeVisible();
    // CodeMirror のコンテンツ領域にテキストが存在する
    const content = page.locator(".cm-content");
    await expect(content).toContainText("R2 Data Catalog");
  });

  test("Run ボタンクリックでクエリが実行される", async ({ page }) => {
    // デフォルトのプレースホルダーを消して SQL を入力
    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("SELECT action, type FROM streaming.linear_events LIMIT 2");

    // Run ボタンをクリック
    await page.click("button:has-text('Run')");

    // 結果が表示されるのを待つ
    await expect(page.locator("table")).toBeVisible({ timeout: 15000 });
    // 行数表示を確認
    await expect(page.locator("text=2 rows")).toBeVisible();
  });

  test("Cmd+Enter でクエリが実行される", async ({ page }) => {
    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("SELECT action FROM streaming.linear_events LIMIT 1");

    // Cmd+Enter で実行
    await page.keyboard.press("Meta+Enter");

    await expect(page.locator("table")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=1 rows")).toBeVisible();
  });

  test("サイドバーにテーブル一覧が表示される", async ({ page }) => {
    // namespace ヘッダー
    await expect(page.locator("text=STREAMING").first()).toBeVisible({ timeout: 10000 });
    // テーブル名
    await expect(page.locator("button:has-text('linear_events')")).toBeVisible();
  });

  test("クエリ結果表示後もサイドバーが消えない", async ({ page }) => {
    const sidebar = page.locator("text=Tables").first();
    await expect(sidebar).toBeVisible();

    // クエリ実行
    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("SELECT action FROM streaming.linear_events LIMIT 1");
    await page.keyboard.press("Meta+Enter");

    // 結果が表示されるのを待つ
    await expect(page.locator("table")).toBeVisible({ timeout: 15000 });

    // サイドバーがまだ表示されている
    await expect(sidebar).toBeVisible();
    await expect(page.locator("button:has-text('linear_events')")).toBeVisible();
  });

  test("エラー時にエラーパネルが表示される", async ({ page }) => {
    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("INVALID SQL QUERY");
    await page.keyboard.press("Meta+Enter");

    // エラー表示を待つ
    await expect(page.locator("text=Query Error")).toBeVisible({ timeout: 15000 });
    // サイドバーはそのまま
    await expect(page.locator("text=Tables").first()).toBeVisible();
  });

  test("テーブル名クリックでエディターに挿入される", async ({ page }) => {
    // テーブルボタンが表示されるのを待つ
    const tableButton = page.locator("button:has-text('linear_events')");
    await expect(tableButton).toBeVisible({ timeout: 10000 });

    // クリック
    await tableButton.click();

    // エディターに挿入されたことを確認
    const content = page.locator(".cm-content");
    await expect(content).toContainText("streaming.linear_events");
  });

  test("空結果時に適切なメッセージが表示される", async ({ page }) => {
    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type(
      "SELECT action FROM streaming.linear_events WHERE action = 'nonexistent_action_xyz' LIMIT 1"
    );
    await page.keyboard.press("Meta+Enter");

    await expect(page.locator("text=0 rows")).toBeVisible({ timeout: 15000 });
  });
});
```

- [ ] **Step 2: テストを実行**

Run: `cd sql-editor && pnpm exec playwright test --reporter=list`
Expected: 全テストがパス（dev server は playwright.config.ts の webServer で自動起動）

注意: テストは実際の R2 SQL API に対して実行される。ローカル `.dev.vars` に `R2_SQL_TOKEN` が設定されている必要がある。

- [ ] **Step 3: biome check**

Run: `cd sql-editor && pnpm exec biome check --write .`

- [ ] **Step 4: コミット**

```bash
git add sql-editor/e2e/
git commit -m "test: add Playwright E2E tests for SQL Editor"
```

---

## Task 5: デプロイ + 最終確認

- [ ] **Step 1: 全チェック実行**

```bash
cd sql-editor
pnpm exec biome check .
pnpm exec tsc -b
pnpm exec playwright test
```

- [ ] **Step 2: デプロイ**

```bash
cd sql-editor && pnpm run deploy
```

- [ ] **Step 3: 本番環境でオートコンプリート確認**

Open: `https://sql-editor.ta93abe.workers.dev`
確認:
- `SELECT ` + Ctrl+Space → カラム名候補が表示される
- `FROM ` + Ctrl+Space → `streaming.linear_events` が候補に表示される
- サイドバーにカラム型バッジは Phase 2 以降（今回はスキップ）

- [ ] **Step 4: コミット（必要に応じて）**

```bash
git add sql-editor/
git commit -m "feat: sql-editor Phase 1.5 complete — autocomplete + E2E tests"
```
