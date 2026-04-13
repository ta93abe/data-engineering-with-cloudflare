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
