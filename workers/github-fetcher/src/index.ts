/**
 * GitHub Fetcher Worker
 *
 * Queue consumer that:
 * 1. Receives repository fetch tasks from Queue
 * 2. Fetches detailed data from GitHub API
 * 3. Converts to Parquet format
 * 4. Saves to R2 in Hive partitioned structure
 */

export interface Env {
  RAW_BUCKET: R2Bucket;
  ANALYTICS: AnalyticsEngineDataset;
  GITHUB_TOKEN: string;
}

interface QueueMessage {
  repository_id: number;
  repository_full_name: string;
  repository_name: string;
  owner: string;
  is_private: boolean;
  execution_id: string;
}

interface GitHubResource {
  resource: string;
  endpoint: string;
  params?: string;
}

export default {
  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    console.log(`Processing batch of ${batch.messages.length} repositories`);

    for (const message of batch.messages) {
      const startTime = Date.now();
      const { repository_full_name, owner, repository_name, execution_id } = message.body;

      try {
        console.log(`[${execution_id}] Processing ${repository_full_name}`);

        // Define resources to fetch
        const resources: GitHubResource[] = [
          { resource: 'repositories', endpoint: `/repos/${repository_full_name}` },
          { resource: 'issues', endpoint: `/repos/${repository_full_name}/issues`, params: 'state=all&per_page=100' },
          { resource: 'pull_requests', endpoint: `/repos/${repository_full_name}/pulls`, params: 'state=all&per_page=100' },
          { resource: 'commits', endpoint: `/repos/${repository_full_name}/commits`, params: 'per_page=100' },
          { resource: 'stargazers', endpoint: `/repos/${repository_full_name}/stargazers`, params: 'per_page=100' },
          { resource: 'releases', endpoint: `/repos/${repository_full_name}/releases`, params: 'per_page=100' },
          { resource: 'workflow_runs', endpoint: `/repos/${repository_full_name}/actions/runs`, params: 'per_page=100' },
        ];

        // Fetch and save each resource
        for (const resource of resources) {
          await fetchAndSaveResource(
            env,
            resource,
            repository_full_name,
            execution_id
          );
        }

        // Mark message as processed
        message.ack();

        const duration = Date.now() - startTime;
        console.log(`[${execution_id}] Completed ${repository_full_name} in ${duration}ms`);

        // Write success analytics
        env.ANALYTICS.writeDataPoint({
          blobs: ['fetcher_success', repository_full_name, execution_id],
          doubles: [duration],
          indexes: ['fetcher_execution'],
        });
      } catch (error) {
        console.error(`[${execution_id}] Error processing ${repository_full_name}:`, error);

        // Retry message (will be retried up to max_retries)
        message.retry();

        // Write error analytics
        env.ANALYTICS.writeDataPoint({
          blobs: ['fetcher_error', repository_full_name, execution_id, String(error)],
          doubles: [0],
          indexes: ['fetcher_execution'],
        });
      }
    }
  },
};

/**
 * Fetch and save a GitHub resource to R2
 */
async function fetchAndSaveResource(
  env: Env,
  resource: GitHubResource,
  repositoryFullName: string,
  executionId: string
): Promise<void> {
  const { resource: resourceName, endpoint, params } = resource;
  const data: any[] = [];

  // Fetch all pages
  let page = 1;
  while (true) {
    const url = params
      ? `https://api.github.com${endpoint}?${params}&page=${page}`
      : `https://api.github.com${endpoint}?page=${page}`;

    const response = await fetchWithRetry(url, {
      headers: {
        'Authorization': `token ${env.GITHUB_TOKEN}`,
        'Accept': resourceName === 'stargazers'
          ? 'application/vnd.github.v3.star+json'
          : 'application/vnd.github.v3+json',
        'User-Agent': 'Cloudflare-Worker-GitHub-Fetcher',
      },
    });

    if (!response.ok) {
      // Handle 404 for resources that might not exist
      if (response.status === 404) {
        console.log(`Resource ${resourceName} not found for ${repositoryFullName}, skipping`);
        return;
      }
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const pageData = await response.json();

    // Handle single object response (e.g., repository details)
    if (!Array.isArray(pageData)) {
      data.push(pageData);
      break;
    }

    // Handle workflow_runs special structure
    if (resourceName === 'workflow_runs' && pageData.workflow_runs) {
      data.push(...pageData.workflow_runs);
    } else {
      data.push(...pageData);
    }

    // Check if there are more pages
    const linkHeader = response.headers.get('Link');
    if (!linkHeader || !linkHeader.includes('rel="next"') || pageData.length === 0) {
      break;
    }

    page++;

    // Safety limit to prevent infinite loops
    if (page > 100) {
      console.warn(`Reached page limit (100) for ${resourceName} in ${repositoryFullName}`);
      break;
    }
  }

  if (data.length === 0) {
    console.log(`No data found for ${resourceName} in ${repositoryFullName}`);
    return;
  }

  // Add metadata to each record
  const enrichedData = data.map(record => ({
    ...record,
    _extracted_at: new Date().toISOString(),
    _execution_id: executionId,
    _repository_full_name: repositoryFullName,
  }));

  // Save to R2 in Hive partitioned structure
  await saveToR2(env.RAW_BUCKET, resourceName, enrichedData);

  console.log(`Saved ${enrichedData.length} ${resourceName} records for ${repositoryFullName}`);
}

/**
 * Save data to R2 in Hive partitioned Parquet format
 */
async function saveToR2(
  bucket: R2Bucket,
  resourceName: string,
  data: any[]
): Promise<void> {
  // Get current date for partitioning
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');

  // Generate unique file ID
  const fileId = crypto.randomUUID();

  // Construct Hive partition path
  const path = `sources/github/${resourceName}/year=${year}/month=${month}/day=${day}/${fileId}.json`;

  // For now, save as JSON (Parquet conversion would require additional library)
  // TODO: Replace with Parquet format using apache-arrow library
  const jsonData = JSON.stringify(data, null, 0);

  await bucket.put(path, jsonData, {
    httpMetadata: {
      contentType: 'application/json',
    },
    customMetadata: {
      resource: resourceName,
      record_count: String(data.length),
      extracted_at: new Date().toISOString(),
    },
  });
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
          ? Math.max(0, parseInt(resetTime) * 1000 - Date.now())
          : Math.pow(2, attempt) * 1000;

        console.log(`Rate limited. Waiting ${waitTime}ms before retry...`);
        await sleep(waitTime);
        continue;
      }

      // Check for server errors (5xx)
      if (response.status >= 500) {
        if (attempt === maxRetries) {
          return response;
        }
        const waitTime = Math.pow(2, attempt) * 1000;
        console.log(`Server error ${response.status}. Retrying in ${waitTime}ms...`);
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
