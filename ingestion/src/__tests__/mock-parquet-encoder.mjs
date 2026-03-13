// Mock parquet-encoder Worker for integration tests.
// Returns fake Parquet bytes (PAR1 magic header + padding + PAR1 footer).
export default {
  async fetch(request) {
    if (request.method === "POST") {
      const buf = new Uint8Array(12);
      // PAR1 magic
      buf[0] = 0x50;
      buf[1] = 0x41;
      buf[2] = 0x52;
      buf[3] = 0x31;
      buf[8] = 0x50;
      buf[9] = 0x41;
      buf[10] = 0x52;
      buf[11] = 0x31;
      return new Response(buf, {
        headers: { "Content-Type": "application/octet-stream" },
      });
    }
    return new Response("OK");
  },
};
