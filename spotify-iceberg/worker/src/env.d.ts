interface Env {
  SPOTIFY_STATE_KV: KVNamespace;
  SPOTIFY_CONTAINER: DurableObjectNamespace;
}

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
