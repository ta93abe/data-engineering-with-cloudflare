import type { DbtRunResult, DbtRunSummary } from "../types";

const RUNS_PREFIX = "dbt-runs/";

export async function saveRunResult(
  r2: R2Bucket,
  result: DbtRunResult,
  artifacts: Record<string, string>
): Promise<void> {
  const prefix = `${RUNS_PREFIX}${result.runId}/`;

  const uploads: Promise<R2Object | null>[] = [
    r2.put(`${prefix}result.json`, JSON.stringify(result, null, 2)),
  ];

  for (const [name, content] of Object.entries(artifacts)) {
    uploads.push(r2.put(`${prefix}${name}`, content));
  }

  await Promise.all(uploads);
}

export async function getRunResult(r2: R2Bucket, runId: string): Promise<DbtRunResult | null> {
  const object = await r2.get(`${RUNS_PREFIX}${runId}/result.json`);
  if (!object) return null;
  return (await object.json()) as DbtRunResult;
}

export async function listRuns(r2: R2Bucket, limit = 20): Promise<DbtRunSummary[]> {
  const listed = await r2.list({ prefix: RUNS_PREFIX, delimiter: "/" });

  const summaries: DbtRunSummary[] = [];

  for (const prefix of listed.delimitedPrefixes) {
    const object = await r2.get(`${prefix}result.json`);
    if (!object) continue;

    const result = (await object.json()) as DbtRunResult;
    summaries.push({
      runId: result.runId,
      ref: result.ref,
      commitSha: result.commitSha,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      success: result.success,
    });
  }

  return summaries
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, limit);
}
