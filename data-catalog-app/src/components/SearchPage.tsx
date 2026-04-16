import { useEffect, useRef } from "react";
import type { ChatPageSnippet } from "@cloudflare/ai-search-snippet";

interface SearchPageProps {
  apiUrl: string;
}

export function SearchPage({ apiUrl }: SearchPageProps) {
  const ref = useRef<ChatPageSnippet>(null);
  const registered = useRef(false);

  useEffect(() => {
    if (registered.current) return;
    registered.current = true;
    import("@cloudflare/ai-search-snippet");
  }, []);

  return (
    <div className="flex flex-col gap-6 h-[calc(100vh-3rem)]">
      <chat-page-snippet
        ref={ref}
        api-url={apiUrl}
        placeholder="データカタログについて質問してください..."
        theme="auto"
      />
    </div>
  );
}
