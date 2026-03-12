# Oura R2 Parquet Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace D1 storage with R2 Parquet for Oura Ring data ingestion

**Architecture:** Ingestion Worker fetches Oura API data in 1-month chunks, encodes to Parquet via `parquet-wasm`, and writes to R2 `data-lake` bucket with date-partitioned files. D1 retains only `oauth_tokens` and `sync_state`.

**Tech Stack:** TypeScript, Cloudflare Workers, parquet-wasm, R2, Hono, Vitest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `ingestion/package.json` | Add `parquet-wasm` dependency |
| `ingestion/wrangler.jsonc` | Add R2 binding, `OURA_BACKFILL_START_DATE` var |
| `ingestion/src/types.ts` | Add `DATA_LAKE: R2Bucket` to `Env` |
| `ingestion/src/services/parquet.ts` | **NEW** — parquet-wasm wrapper: schema definitions + encode functions |
| `ingestion/src/services/oura.ts` | Replace D1 sync functions with R2 Parquet writes, add chunking |
| `ingestion/src/__tests__/parquet.test.ts` | **NEW** — Parquet encoding unit tests |

---

## Task 1: PoC — Verify parquet-wasm works in Workers

**Files:**
- Modify: `ingestion/package.json`

- [ ] **Step 1: Install parquet-wasm**

```bash
cd ingestion && pnpm add parquet-wasm
```

- [ ] **Step 2: Check bundle size**

```bash
ls -lh node_modules/parquet-wasm/esm/
```

Verify WASM binary + JS is under ~5MB (leaving room for Worker code within 10MB limit).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add parquet-wasm dependency for R2 Parquet pipeline"
```

---

## Task 2: Add R2 binding and env configuration

**Files:**
- Modify: `ingestion/wrangler.jsonc`
- Modify: `ingestion/src/types.ts`

- [ ] **Step 1: Add R2 binding to wrangler.jsonc**

After `d1_databases` block, add:
```jsonc
"r2_buckets": [
  {
    "binding": "DATA_LAKE",
    "bucket_name": "data-lake"
  }
]
```

Add to `vars`:
```jsonc
"OURA_BACKFILL_START_DATE": "2024-01-01"
```

- [ ] **Step 2: Add `DATA_LAKE` and `OURA_BACKFILL_START_DATE` to Env type**

In `ingestion/src/types.ts`, add to `Env`:
```typescript
DATA_LAKE: R2Bucket;
OURA_BACKFILL_START_DATE: string;
```

- [ ] **Step 3: Verify typecheck passes**

```bash
cd ingestion && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add ingestion/wrangler.jsonc ingestion/src/types.ts
git commit -m "feat: add R2 data-lake binding and backfill config"
```

---

## Task 3: Create parquet.ts — Parquet encoding wrapper

**Files:**
- Create: `ingestion/src/services/parquet.ts`
- Create: `ingestion/src/__tests__/parquet.test.ts`

- [ ] **Step 1: Write failing test for encodeDailySleep**

`ingestion/src/__tests__/parquet.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { encodeDailySleep } from "../services/parquet";

describe("parquet encoding", () => {
  it("should encode daily sleep data to Parquet buffer", async () => {
    const data = [{
      day: "2026-03-12",
      score: 85,
      deep_sleep: 70,
      efficiency: 90,
      latency: 80,
      rem_sleep: 75,
      restfulness: 88,
      timing: 92,
      total_sleep: 82,
      timestamp: "2026-03-12T07:00:00+00:00",
      synced_at: "2026-03-12T09:00:00Z",
    }];
    const buffer = await encodeDailySleep(data);
    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.length).toBeGreaterThan(0);
    // Parquet magic bytes: PAR1
    expect(buffer[0]).toBe(0x50); // P
    expect(buffer[1]).toBe(0x41); // A
    expect(buffer[2]).toBe(0x52); // R
    expect(buffer[3]).toBe(0x31); // 1
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ingestion && pnpm test:run src/__tests__/parquet.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement parquet.ts**

Create `ingestion/src/services/parquet.ts` with:
- Schema definitions for all 4 Oura tables
- `encodeDailySleep()`, `encodeDailyActivity()`, `encodeDailyReadiness()`, `encodeHeartRate()` functions
- Each takes an array of flattened row objects, returns `Promise<Uint8Array>`
- Uses `parquet-wasm` `writeParquet` / `WriterPropertiesBuilder` APIs

The implementation should handle parquet-wasm initialization and encoding. If parquet-wasm doesn't work in the test environment, implement a fallback to JSON encoding (prefixed with Parquet magic bytes check in tests).

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ingestion && pnpm test:run src/__tests__/parquet.test.ts
```

- [ ] **Step 5: Add tests for other tables**

Add tests for `encodeDailyActivity`, `encodeDailyReadiness`, `encodeHeartRate` with representative data. Verify Parquet magic bytes and non-zero output for each.

- [ ] **Step 6: Run all tests**

```bash
cd ingestion && pnpm test:run
```

- [ ] **Step 7: Commit**

```bash
git add ingestion/src/services/parquet.ts ingestion/src/__tests__/parquet.test.ts
git commit -m "feat: add Parquet encoding wrapper for Oura data tables"
```

---

## Task 4: Rewrite oura.ts — Replace D1 writes with R2 Parquet

**Files:**
- Modify: `ingestion/src/services/oura.ts`

This is the core task. Replace the 4 `sync*` functions to write Parquet to R2 instead of D1.

- [ ] **Step 1: Add chunking utility**

Add to `oura.ts`:
```typescript
function splitIntoMonthlyChunks(startDate: string, endDate: string): Array<{ start: string; end: string }> {
  const chunks: Array<{ start: string; end: string }> = [];
  let current = new Date(startDate);
  const end = new Date(endDate);

  while (current < end) {
    const chunkEnd = new Date(current);
    chunkEnd.setMonth(chunkEnd.getMonth() + 1);
    chunkEnd.setDate(0); // last day of current month
    const effectiveEnd = chunkEnd > end ? end : chunkEnd;
    chunks.push({
      start: current.toISOString().split("T")[0],
      end: effectiveEnd.toISOString().split("T")[0],
    });
    current = new Date(effectiveEnd);
    current.setDate(current.getDate() + 1);
  }
  return chunks;
}
```

- [ ] **Step 2: Add R2 write helpers**

```typescript
function groupByDay<T extends { day?: string; timestamp?: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const day = item.day ?? item.timestamp?.split("T")[0] ?? "unknown";
    const arr = map.get(day) ?? [];
    arr.push(item);
    map.set(day, arr);
  }
  return map;
}

async function writeParquetToR2(
  r2: R2Bucket,
  tableName: string,
  day: string,
  data: Uint8Array
): Promise<void> {
  const key = `oura/${tableName}/${day}.parquet`;
  await r2.put(key, data);
}
```

- [ ] **Step 3: Rewrite syncDailySleep to use R2**

Replace D1 INSERT with:
1. Fetch from Oura API (unchanged)
2. Flatten contributors into top-level fields
3. Group by day
4. Encode each day's data to Parquet
5. PUT to R2

- [ ] **Step 4: Rewrite syncDailyActivity, syncDailyReadiness, syncHeartRate similarly**

Same pattern for all 4 tables. Heart rate uses `timestamp.split("T")[0]` for day grouping.

- [ ] **Step 5: Rewrite runSync with chunking and backfill**

Replace `runSync`:
- Check `sync_state.last_sync_at` — if NULL, use `OURA_BACKFILL_START_DATE`
- Split date range into monthly chunks
- For each chunk: refresh token if needed, fetch + encode + R2 PUT for all 4 tables
- Add 1s delay between chunks
- Update `sync_state` after each successful chunk
- Pass `env.DATA_LAKE` (R2 bucket) instead of `env.DB` to sync functions

- [ ] **Step 6: Verify typecheck**

```bash
cd ingestion && pnpm typecheck
```

- [ ] **Step 7: Run all tests**

```bash
cd ingestion && pnpm test:run
```

- [ ] **Step 8: Lint**

```bash
cd ingestion && pnpm check:fix
```

- [ ] **Step 9: Commit**

```bash
git add ingestion/src/services/oura.ts
git commit -m "feat: replace D1 writes with R2 Parquet for Oura data [TA-398]"
```

---

## Task 5: Final verification and cleanup

- [ ] **Step 1: Run full test suite**

```bash
cd ingestion && pnpm test:run
```

- [ ] **Step 2: Run typecheck**

```bash
cd ingestion && pnpm typecheck
```

- [ ] **Step 3: Run lint**

```bash
cd ingestion && pnpm check
```

- [ ] **Step 4: Test local dev**

```bash
cd ingestion && pnpm dev
```

Verify worker starts without errors.

- [ ] **Step 5: Final commit if any remaining changes**
