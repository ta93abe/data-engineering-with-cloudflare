import { useCallback, useState } from "react";
import { executeQuery, type QueryResult } from "../lib/api";

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
