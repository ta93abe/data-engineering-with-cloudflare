import type { QueryResult } from "../lib/api";

interface ResultPanelProps {
  result: QueryResult | null;
  loading: boolean;
}

const MUTED_COLOR = "light-dark(#888, #a1a1aa)";
const SUCCESS_COLOR = "light-dark(#16a34a, #22c55e)";
const BORDER_COLOR = "light-dark(#e5e7eb, #27272a)";
const ROW_BORDER = "light-dark(#f3f4f6, #1f1f23)";
const HEADER_BG = "light-dark(#ffffff, #0f0f10)";
const TEXT_HEADER = "light-dark(#374151, #d4d4d8)";
const TEXT_MUTED = "light-dark(#9ca3af, #71717a)";

export default function ResultPanel({ result, loading }: ResultPanelProps) {
  if (loading) {
    return <div style={{ padding: 16, color: MUTED_COLOR }}>クエリを実行中...</div>;
  }

  if (!result) {
    return (
      <div style={{ padding: 16, color: MUTED_COLOR }}>
        Cmd+Enter または Run ボタンでクエリを実行
      </div>
    );
  }

  if (result.error) {
    return (
      <div style={{ padding: 16 }}>
        <div
          style={{
            background: "light-dark(#fef2f2, #450a0a)",
            border: "1px solid light-dark(#fecaca, #7f1d1d)",
            borderRadius: 6,
            padding: 12,
          }}
        >
          <div
            style={{
              fontWeight: 600,
              color: "light-dark(#dc2626, #f87171)",
              marginBottom: 4,
            }}
          >
            Query Error {result.engine ? `· ${result.engine}` : ""}
          </div>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              fontSize: 13,
              color: "light-dark(#991b1b, #fca5a5)",
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
        <div style={{ color: SUCCESS_COLOR, fontWeight: 600, marginBottom: 8 }}>
          0 rows · {result.elapsed}ms · {result.engine}
        </div>
        <div style={{ color: MUTED_COLOR }}>クエリは成功しましたが、結果は0件です。</div>
      </div>
    );
  }

  const columns = Object.keys(rows[0]);

  return (
    <div style={{ padding: "8px 16px" }}>
      <div
        style={{
          marginBottom: 8,
          color: SUCCESS_COLOR,
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
                  borderBottom: `2px solid ${BORDER_COLOR}`,
                  textAlign: "left",
                  fontWeight: 600,
                  color: TEXT_HEADER,
                  position: "sticky",
                  top: 0,
                  background: HEADER_BG,
                }}
              >
                #
              </th>
              {columns.map((col) => (
                <th
                  key={col}
                  style={{
                    padding: "6px 12px",
                    borderBottom: `2px solid ${BORDER_COLOR}`,
                    textAlign: "left",
                    fontWeight: 600,
                    color: TEXT_HEADER,
                    position: "sticky",
                    top: 0,
                    background: HEADER_BG,
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
              <tr key={i} style={{ borderBottom: `1px solid ${ROW_BORDER}` }}>
                <td
                  style={{
                    padding: "6px 12px",
                    color: TEXT_MUTED,
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
