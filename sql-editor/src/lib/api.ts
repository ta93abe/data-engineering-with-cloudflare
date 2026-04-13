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

export async function describeTable(namespace: string, table: string): Promise<DescribeResult> {
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

export interface ColumnInfo {
  column_name: string;
  type: string;
  required: string;
}

export interface DescribeResult {
  data?: ColumnInfo[];
  error?: string;
}
