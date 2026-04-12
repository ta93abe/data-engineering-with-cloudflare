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
        {loading ? "Running..." : "Run (R2 SQL)"}
      </button>
      <span style={{ fontSize: 12, color: "#888" }}>Cmd+Enter</span>
      {result?.elapsed && (
        <span style={{ fontSize: 12, color: "#888", marginLeft: "auto" }}>{result.elapsed}ms</span>
      )}
    </div>
  );
}
