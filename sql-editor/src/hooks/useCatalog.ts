import { useEffect, useState } from "react";
import { type ColumnInfo, describeTable, fetchTables, type TablesResult } from "../lib/api";

export interface TableInfo {
  namespace: string;
  table: string;
  columns?: ColumnInfo[];
}

// Nested schema format understood by @codemirror/lang-sql:
//   { namespace: { table: [column1, column2, ...] } }
// This enables multi-part identifier autocompletion (e.g. typing `streaming.`
// suggests table names, typing `streaming.linear_events.` suggests columns).
export type SqlSchema = Record<string, Record<string, string[]>>;

export function useCatalog() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [schema, setSchema] = useState<SqlSchema>({});
  const [loadingTables, setLoadingTables] = useState(true);

  useEffect(() => {
    fetchTables()
      .then(async (res: TablesResult) => {
        const list = res.tables ?? [];

        // Use allSettled so one failing DESCRIBE doesn't wipe the whole catalog.
        const settled = await Promise.allSettled(
          list.map(async (t) => {
            const desc = await describeTable(t.namespace, t.table);
            return { namespace: t.namespace, table: t.table, columns: desc.data ?? [] };
          })
        );

        const newSchema: SqlSchema = {};
        const enriched: TableInfo[] = [];
        for (let i = 0; i < settled.length; i++) {
          const outcome = settled[i];
          if (outcome.status === "fulfilled") {
            const d = outcome.value;
            if (!newSchema[d.namespace]) newSchema[d.namespace] = {};
            newSchema[d.namespace][d.table] = d.columns.map((c) => c.column_name);
            enriched.push({ namespace: d.namespace, table: d.table, columns: d.columns });
          } else {
            const t = list[i];
            console.warn(`Failed to describe ${t.namespace}.${t.table}:`, outcome.reason);
            // Still include the table (without columns) so it shows up in the sidebar.
            enriched.push({ namespace: t.namespace, table: t.table });
          }
        }
        setTables(enriched);
        setSchema(newSchema);
      })
      .catch(() => setTables([]))
      .finally(() => setLoadingTables(false));
  }, []);

  return { tables, schema, loadingTables };
}
