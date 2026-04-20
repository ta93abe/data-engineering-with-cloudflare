import { Container } from "@cloudflare/containers";

export class SpotifyContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";
}

SpotifyContainer.outboundByHost = {
  "kv.internal": async (request, env: Env): Promise<Response> => {
    const url = new URL(request.url);
    const key = url.pathname.slice(1);
    if (!key) return new Response("missing key", { status: 400 });

    if (request.method === "GET") {
      const value = await env.SPOTIFY_STATE_KV.get(key);
      if (value === null) return new Response("", { status: 404 });
      return new Response(value, { status: 200 });
    }

    if (request.method === "PUT") {
      const body = await request.text();
      await env.SPOTIFY_STATE_KV.put(key, body);
      return new Response(null, { status: 204 });
    }

    return new Response("method not allowed", { status: 405 });
  },
};

export default {
  async scheduled(_event, env, _ctx) {
    const id = env.SPOTIFY_CONTAINER.idFromName("spotify");
    const stub = env.SPOTIFY_CONTAINER.get(id);
    const res = await stub.fetch("http://container/run", { method: "POST" });
    console.log(`container /run status=${res.status}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`container /run failed: ${res.status} ${body}`);
    }
  },
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/trigger") {
      const id = env.SPOTIFY_CONTAINER.idFromName("spotify");
      const stub = env.SPOTIFY_CONTAINER.get(id);
      return stub.fetch("http://container/run", { method: "POST" });
    }
    return new Response("spotify-iceberg worker", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
