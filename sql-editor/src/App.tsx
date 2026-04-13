import { useState } from "react";
import Editor from "./components/Editor";
import ResultPanel from "./components/ResultPanel";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import { useCatalog } from "./hooks/useCatalog";
import { useQuery } from "./hooks/useQuery";

export default function App() {
  const [sql, setSql] = useState(
    "-- R2 Data Catalog の Iceberg テーブルにクエリを実行できます\n-- 例: SELECT * FROM streaming.linear_events LIMIT 10\n-- Cmd+Enter で実行\n"
  );
  const { result, loading, execute } = useQuery();
  const { tables, schema, loadingTables } = useCatalog();

  const handleRun = () => execute(sql);

  const handleInsert = (text: string) => {
    setSql((prev) => `${prev}${text}`);
  };

  return (
    <div style={{ display: "flex", height: "100vh", flexDirection: "column" }}>
      <header
        style={{
          padding: "8px 16px",
          borderBottom: "1px solid light-dark(#e5e7eb, #27272a)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <strong>SQL Editor</strong>
        <span style={{ fontSize: "12px", color: "light-dark(#888, #a1a1aa)" }}>
          R2 Data Catalog
        </span>
      </header>
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Sidebar tables={tables} loading={loadingTables} onInsert={handleInsert} />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ flex: 1, minHeight: 0 }}>
            <Editor value={sql} onChange={setSql} onRun={handleRun} schema={schema} />
          </div>
          <Toolbar loading={loading} onRun={handleRun} result={result} />
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <ResultPanel result={result} loading={loading} />
          </div>
        </div>
      </div>
    </div>
  );
}
