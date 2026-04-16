import type { APIRoute } from "astro";

export const POST: APIRoute = async ({ request, locals }) => {
  const { query } = await request.json();
  if (!query || typeof query !== "string") {
    return new Response(JSON.stringify({ error: "query is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const ai = locals.runtime.env.AI;
    const result = await ai.autorag("data-catalog").aiSearch(query);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Search failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
