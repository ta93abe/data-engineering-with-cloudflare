import type { TableInfo } from "../hooks/useCatalog";

interface SidebarProps {
  tables: TableInfo[];
  loading: boolean;
  onInsert: (text: string) => void;
}

export default function Sidebar({ tables, loading, onInsert }: SidebarProps) {
  const grouped = tables.reduce<Record<string, TableInfo[]>>((acc, t) => {
    if (!acc[t.namespace]) {
      acc[t.namespace] = [];
    }
    acc[t.namespace].push(t);
    return acc;
  }, {});

  return (
    <div
      style={{
        width: 240,
        borderRight: "1px solid #e5e7eb",
        overflow: "auto",
        padding: "12px 0",
        fontSize: 13,
      }}
    >
      <div
        style={{
          padding: "0 12px 8px",
          fontWeight: 600,
          color: "#374151",
        }}
      >
        Tables
      </div>
      {loading ? (
        <div style={{ padding: "0 12px", color: "#888" }}>Loading...</div>
      ) : (
        Object.entries(grouped).map(([ns, tbls]) => (
          <div key={ns} style={{ marginBottom: 8 }}>
            <div
              style={{
                padding: "4px 12px",
                fontWeight: 600,
                color: "#6b7280",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {ns}
            </div>
            {tbls.map((t) => (
              <button
                type="button"
                key={`${t.namespace}.${t.table}`}
                onClick={() => onInsert(`${t.namespace}.${t.table}`)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "4px 12px 4px 20px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#1f2937",
                  fontSize: 13,
                }}
                title={`Click to insert ${t.namespace}.${t.table}`}
              >
                {t.table}
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
