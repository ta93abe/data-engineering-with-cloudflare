import { useEffect, useState } from "react";
import { type ColumnInfo, describeTable, fetchTables, type TablesResult } from "../lib/api";

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

        const described = await Promise.all(
          list.map(async (t) => {
            const desc = await describeTable(t.namespace, t.table);
            return { namespace: t.namespace, table: t.table, columns: desc.data ?? [] };
          })
        );

        const newSchema: SqlSchema = {};
        const enriched: TableInfo[] = [];
        for (const d of described) {
          newSchema[`${d.namespace}.${d.table}`] = d.columns.map((c) => c.column_name);
          enriched.push({ namespace: d.namespace, table: d.table, columns: d.columns });
        }
        setTables(enriched);
        setSchema(newSchema);
      })
      .catch(() => setTables([]))
      .finally(() => setLoadingTables(false));
  }, []);

  return { tables, schema, loadingTables };
}
