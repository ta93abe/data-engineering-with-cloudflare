import { useState } from "react";
import { Button, Input, Surface, Text } from "@cloudflare/kumo";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";

interface SearchResultData {
  source: string;
  content: string;
  score: number;
}

interface SearchResult {
  response?: string;
  data?: SearchResultData[];
  error?: string;
}

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data: SearchResult = await res.json();
      setResult(data);
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Search failed" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <Text className="font-bold text-2xl">Search</Text>
        <Text className="text-kumo-subtle">
          Ask questions about your data catalog in natural language.
        </Text>
      </div>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <Input
          placeholder="e.g. What models are in the marts layer?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={loading || !query.trim()}>
          {loading ? (
            "Searching..."
          ) : (
            <>
              <MagnifyingGlassIcon size={16} />
              Search
            </>
          )}
        </Button>
      </form>

      {/* Error */}
      {result?.error && (
        <Surface className="rounded-lg p-4">
          <Text className="text-red-500">{result.error}</Text>
        </Surface>
      )}

      {/* AI Answer */}
      {result?.response && (
        <Surface className="rounded-lg p-4 flex flex-col gap-2">
          <Text className="font-semibold">AI Answer</Text>
          <Text>{result.response}</Text>
        </Surface>
      )}

      {/* Source documents */}
      {result?.data && result.data.length > 0 && (
        <div className="flex flex-col gap-3">
          <Text className="font-semibold">Sources ({result.data.length})</Text>
          {result.data.map((item, i) => (
            <Surface key={i} className="rounded-lg p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Text className="font-mono text-sm font-medium">{item.source}</Text>
                <Text className="text-kumo-subtle text-xs">
                  Score: {item.score.toFixed(3)}
                </Text>
              </div>
              <Text className="text-kumo-subtle text-sm">{item.content}</Text>
            </Surface>
          ))}
        </div>
      )}
    </div>
  );
}
