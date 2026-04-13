import type { QueryResult } from "../lib/api";

interface ResultPanelProps {
  result: QueryResult | null;
  loading: boolean;
}

export default function ResultPanel({ result, loading }: ResultPanelProps) {
  if (loading) {
    return <div style={{ padding: 16, color: "#888" }}>クエリを実行中...</div>;
  }

  if (!result) {
    return (
      <div style={{ padding: 16, color: "#888" }}>Cmd+Enter または Run ボタンでクエリを実行</div>
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
          0 rows · {result.elapsed}ms · {result.engine}
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
        {rows.length} rows · {result.elapsed}ms · {result.engine}
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
              // biome-ignore lint/suspicious/noArrayIndexKey: SQL result rows have no stable unique key
              <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
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
