import { useCallback, useEffect, useState } from "react";
import { type DescribeResult, describeTable, fetchTables, type TablesResult } from "../lib/api";

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

  const loadColumns = useCallback(async (namespace: string, table: string) => {
    const res = await describeTable(namespace, table);
    setTables((prev) =>
      prev.map((t) =>
        t.namespace === namespace && t.table === table ? { ...t, columns: res.data } : t
      )
    );
  }, []);

  return { tables, loadingTables, loadColumns };
}
