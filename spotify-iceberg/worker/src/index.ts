import { Container } from "@cloudflare/containers";

export class SpotifyContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";
}

export default {
  async scheduled(_event, env, _ctx) {
    const id = env.SPOTIFY_CONTAINER.idFromName("spotify");
    const stub = env.SPOTIFY_CONTAINER.get(id);
    const res = await stub.fetch("http://container/health");
    console.log(`health: ${res.status}`);
  },
  async fetch(_request, _env) {
    return new Response("spotify-iceberg worker", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
