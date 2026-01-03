/**
 * GitHub Scheduler Worker
 *
 * Cron-triggered worker that:
 * 1. Fetches list of repositories from GitHub API
 * 2. Sends each repository to Queue for parallel processing
 * 3. Stores execution metadata in KV
 */

export interface Env {
  GITHUB_QUEUE: Queue;
  METADATA_KV: KVNamespace;
  ANALYTICS: AnalyticsEngineDataset;
  GITHUB_TOKEN: string;
}

interface Repository {
  id: number;
  full_name: string;
  name: string;
  owner: {
    login: string;
  };
  private: boolean;
  html_url: string;
}

interface ExecutionMetadata {
  execution_id: string;
  started_at: string;
  repositories_count: number;
  status: 'running' | 'completed' | 'failed';
  ended_at?: string;
  error?: string;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const executionId = crypto.randomUUID();
    const startTime = new Date().toISOString();

    console.log(`[${executionId}] Starting GitHub data fetch scheduler`);

    const metadata: ExecutionMetadata = {
      execution_id: executionId,
      started_at: startTime,
      repositories_count: 0,
      status: 'running',
    };

    try {
      // Store initial execution metadata
      await env.METADATA_KV.put(
        `execution:${executionId}`,
        JSON.stringify(metadata),
        { expirationTtl: 86400 * 30 } // 30 days
      );

      // Fetch all repositories
      const repositories = await fetchAllRepositories(env.GITHUB_TOKEN);
      console.log(`[${executionId}] Found ${repositories.length} repositories`);

      // Send each repository to the queue
      const queueMessages = repositories.map(repo => ({
        body: {
          repository_id: repo.id,
          repository_full_name: repo.full_name,
          repository_name: repo.name,
          owner: repo.owner.login,
          is_private: repo.private,
          execution_id: executionId,
        },
      }));

      // Send messages in batches (max 100 per batch)
      const batchSize = 100;
      for (let i = 0; i < queueMessages.length; i += batchSize) {
        const batch = queueMessages.slice(i, i + batchSize);
        await env.GITHUB_QUEUE.sendBatch(batch);
        console.log(`[${executionId}] Sent batch ${Math.floor(i / batchSize) + 1} (${batch.length} repositories)`);
      }

      // Update execution metadata
      metadata.repositories_count = repositories.length;
      metadata.status = 'completed';
      metadata.ended_at = new Date().toISOString();

      await env.METADATA_KV.put(
        `execution:${executionId}`,
        JSON.stringify(metadata),
        { expirationTtl: 86400 * 30 }
      );

      // Write analytics
      env.ANALYTICS.writeDataPoint({
        blobs: ['scheduler_success', executionId],
        doubles: [repositories.length],
        indexes: ['scheduler_execution'],
      });

      console.log(`[${executionId}] Scheduler execution completed successfully`);
    } catch (error) {
      console.error(`[${executionId}] Scheduler execution failed:`, error);

      // Update metadata with error
      metadata.status = 'failed';
      metadata.ended_at = new Date().toISOString();
      metadata.error = error instanceof Error ? error.message : String(error);

      await env.METADATA_KV.put(
        `execution:${executionId}`,
        JSON.stringify(metadata),
        { expirationTtl: 86400 * 30 }
      );

      // Write error analytics
      env.ANALYTICS.writeDataPoint({
        blobs: ['scheduler_error', executionId, metadata.error],
        doubles: [0],
        indexes: ['scheduler_execution'],
      });

      throw error;
    }
  },

  // HTTP endpoint for manual triggering and status checks
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // GET /status/:execution_id - Get execution status
    if (url.pathname.startsWith('/status/') && request.method === 'GET') {
      const executionId = url.pathname.split('/')[2];
      const metadata = await env.METADATA_KV.get(`execution:${executionId}`, 'json');

      if (!metadata) {
        return new Response('Execution not found', { status: 404 });
      }

      return new Response(JSON.stringify(metadata, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST /trigger - Manual trigger
    if (url.pathname === '/trigger' && request.method === 'POST') {
      // Trigger the scheduler manually
      const event = {
        cron: 'manual',
        scheduledTime: Date.now(),
      } as ScheduledEvent;

      await this.scheduled(event, env, {} as ExecutionContext);

      return new Response('Scheduler triggered successfully', { status: 200 });
    }

    return new Response('GitHub Scheduler Worker\n\nEndpoints:\n- GET /status/:execution_id\n- POST /trigger', {
      status: 200,
    });
  },
};

/**
 * Fetch all repositories for the authenticated user
 */
async function fetchAllRepositories(token: string): Promise<Repository[]> {
  const repositories: Repository[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await fetchWithRetry(
      `https://api.github.com/user/repos?per_page=${perPage}&page=${page}&sort=updated&direction=desc`,
      {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Cloudflare-Worker-GitHub-Scheduler',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const repos: Repository[] = await response.json();

    if (repos.length === 0) {
      break;
    }

    repositories.push(...repos);

    // Check if there are more pages
    const linkHeader = response.headers.get('Link');
    if (!linkHeader || !linkHeader.includes('rel="next"')) {
      break;
    }

    page++;
  }

  return repositories;
}

/**
 * Fetch with exponential backoff retry
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Check for rate limiting
      if (response.status === 429) {
        const resetTime = response.headers.get('X-RateLimit-Reset');
        const waitTime = resetTime
          ? (parseInt(resetTime) * 1000 - Date.now())
          : Math.pow(2, attempt) * 1000;

        console.log(`Rate limited. Waiting ${waitTime}ms before retry...`);
        await sleep(waitTime);
        continue;
      }

      return response;
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }

      const waitTime = Math.pow(2, attempt) * 1000;
      console.log(`Request failed. Retrying in ${waitTime}ms... (attempt ${attempt + 1}/${maxRetries})`);
      await sleep(waitTime);
    }
  }

  throw new Error('Max retries exceeded');
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
