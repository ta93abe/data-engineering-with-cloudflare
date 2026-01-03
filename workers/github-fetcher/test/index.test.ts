import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock environment
const createMockEnv = () => {
  const r2Objects: Map<string, any> = new Map();
  const analyticsData: any[] = [];

  return {
    GITHUB_TOKEN: 'test-token',
    RAW_BUCKET: {
      put: vi.fn(async (key: string, value: any, options?: any) => {
        r2Objects.set(key, { value, options });
      }),
      get: vi.fn(async (key: string) => {
        return r2Objects.get(key);
      }),
      _objects: r2Objects,
    },
    ANALYTICS: {
      writeDataPoint: vi.fn((data: any) => {
        analyticsData.push(data);
      }),
      _data: analyticsData,
    },
  };
};

// Mock Queue Message
const createMockMessage = (overrides = {}) => {
  let acked = false;
  let retried = false;

  return {
    id: 'msg-123',
    timestamp: new Date(),
    body: {
      repository_id: 1,
      repository_full_name: 'user/test-repo',
      repository_name: 'test-repo',
      owner: 'user',
      is_private: false,
      execution_id: 'exec-123',
      ...overrides,
    },
    ack: vi.fn(() => {
      acked = true;
    }),
    retry: vi.fn(() => {
      retried = true;
    }),
    _acked: () => acked,
    _retried: () => retried,
  };
};

// Mock fetch
const createMockFetch = (responseMap: Map<string, any>) => {
  return vi.fn(async (url: string, options?: any) => {
    for (const [pattern, response] of responseMap.entries()) {
      if (url.includes(pattern)) {
        return {
          ok: response.ok ?? true,
          status: response.status ?? 200,
          statusText: response.statusText ?? 'OK',
          json: async () => response.data || [],
          headers: new Map(Object.entries(response.headers || {})),
        };
      }
    }

    // Default response
    return {
      ok: true,
      status: 200,
      json: async () => [],
      headers: new Map(),
    };
  });
};

describe('GitHub Fetcher Worker', () => {
  let env: any;
  let originalFetch: any;

  beforeEach(() => {
    env = createMockEnv();
    originalFetch = global.fetch;
  });

  describe('Queue message processing', () => {
    it('should process a single repository message', async () => {
      const mockRepoData = {
        id: 1,
        full_name: 'user/test-repo',
        name: 'test-repo',
        stargazers_count: 100,
      };

      global.fetch = createMockFetch(
        new Map([
          ['/repos/user/test-repo', { ok: true, data: mockRepoData }],
          ['/issues', { ok: true, data: [] }],
          ['/pulls', { ok: true, data: [] }],
          ['/commits', { ok: true, data: [] }],
          ['/stargazers', { ok: true, data: [] }],
          ['/releases', { ok: true, data: [] }],
          ['/actions/runs', { ok: true, data: { workflow_runs: [] } }],
        ])
      );

      const { default: worker } = await import('../src/index');

      const message = createMockMessage();
      const batch = {
        queue: 'github-fetch-queue',
        messages: [message],
      } as MessageBatch;

      await worker.queue(batch, env);

      // Should ack the message
      expect(message.ack).toHaveBeenCalled();

      // Should have written to R2 (at least repositories)
      expect(env.RAW_BUCKET.put).toHaveBeenCalled();

      // Should write success analytics
      expect(env.ANALYTICS.writeDataPoint).toHaveBeenCalledWith(
        expect.objectContaining({
          blobs: expect.arrayContaining(['fetcher_success']),
        })
      );

      global.fetch = originalFetch;
    });

    it('should process multiple messages in batch', async () => {
      global.fetch = createMockFetch(
        new Map([
          ['/repos/', { ok: true, data: { id: 1 } }],
          ['/issues', { ok: true, data: [] }],
          ['/pulls', { ok: true, data: [] }],
          ['/commits', { ok: true, data: [] }],
          ['/stargazers', { ok: true, data: [] }],
          ['/releases', { ok: true, data: [] }],
          ['/actions/runs', { ok: true, data: { workflow_runs: [] } }],
        ])
      );

      const { default: worker } = await import('../src/index');

      const messages = [
        createMockMessage({ repository_full_name: 'user/repo1' }),
        createMockMessage({ repository_full_name: 'user/repo2' }),
        createMockMessage({ repository_full_name: 'user/repo3' }),
      ];

      const batch = {
        queue: 'github-fetch-queue',
        messages,
      } as MessageBatch;

      await worker.queue(batch, env);

      // All messages should be acked
      messages.forEach((msg) => {
        expect(msg.ack).toHaveBeenCalled();
      });

      global.fetch = originalFetch;
    });

    it('should retry message on error', async () => {
      global.fetch = vi.fn(async () => {
        throw new Error('Network error');
      });

      const { default: worker } = await import('../src/index');

      const message = createMockMessage();
      const batch = {
        queue: 'github-fetch-queue',
        messages: [message],
      } as MessageBatch;

      await worker.queue(batch, env);

      // Should retry the message
      expect(message.retry).toHaveBeenCalled();

      // Should write error analytics
      expect(env.ANALYTICS.writeDataPoint).toHaveBeenCalledWith(
        expect.objectContaining({
          blobs: expect.arrayContaining(['fetcher_error']),
        })
      );

      global.fetch = originalFetch;
    });
  });

  describe('GitHub API fetching', () => {
    it('should fetch all resource types', async () => {
      const mockData = {
        repository: { id: 1, name: 'test-repo' },
        issues: [{ id: 1, title: 'Issue 1' }],
        pulls: [{ id: 1, title: 'PR 1' }],
        commits: [{ sha: 'abc123' }],
        stargazers: [{ user: { login: 'user1' } }],
        releases: [{ id: 1, tag_name: 'v1.0.0' }],
        workflow_runs: [{ id: 1, name: 'CI' }],
      };

      global.fetch = createMockFetch(
        new Map([
          ['/repos/user/test-repo', { ok: true, data: mockData.repository }],
          ['/issues', { ok: true, data: mockData.issues }],
          ['/pulls', { ok: true, data: mockData.pulls }],
          ['/commits', { ok: true, data: mockData.commits }],
          ['/stargazers', { ok: true, data: mockData.stargazers }],
          ['/releases', { ok: true, data: mockData.releases }],
          ['/actions/runs', { ok: true, data: { workflow_runs: mockData.workflow_runs } }],
        ])
      );

      const { default: worker } = await import('../src/index');

      const message = createMockMessage();
      const batch = {
        queue: 'github-fetch-queue',
        messages: [message],
      } as MessageBatch;

      await worker.queue(batch, env);

      // Should have fetched all 7 resource types
      expect(global.fetch).toHaveBeenCalledTimes(7);

      // Verify each resource type endpoint was called
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/repos/user/test-repo'),
        expect.any(Object)
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/issues'),
        expect.any(Object)
      );

      global.fetch = originalFetch;
    });

    it('should handle pagination for resources', async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
      const page2 = Array.from({ length: 50 }, (_, i) => ({ id: i + 101 }));

      let issuesCallCount = 0;
      global.fetch = vi.fn(async (url: string) => {
        if (url.includes('/issues')) {
          issuesCallCount++;
          if (issuesCallCount === 1) {
            return {
              ok: true,
              status: 200,
              json: async () => page1,
              headers: new Map([['Link', '<...>; rel="next"']]),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => page2,
            headers: new Map(),
          };
        }

        // Default responses for other endpoints
        return {
          ok: true,
          status: 200,
          json: async () => (url.includes('/repos/') ? { id: 1 } : []),
          headers: new Map(),
        };
      });

      const { default: worker } = await import('../src/index');

      const message = createMockMessage();
      const batch = {
        queue: 'github-fetch-queue',
        messages: [message],
      } as MessageBatch;

      await worker.queue(batch, env);

      // Should have paginated for issues
      expect(issuesCallCount).toBe(2);

      global.fetch = originalFetch;
    });

    it('should handle 404 errors gracefully', async () => {
      global.fetch = createMockFetch(
        new Map([
          ['/repos/user/test-repo', { ok: true, data: { id: 1 } }],
          ['/issues', { ok: true, data: [] }],
          ['/pulls', { ok: true, data: [] }],
          ['/commits', { ok: true, data: [] }],
          ['/stargazers', { ok: true, data: [] }],
          ['/releases', { ok: false, status: 404, statusText: 'Not Found' }],
          ['/actions/runs', { ok: false, status: 404, statusText: 'Not Found' }],
        ])
      );

      const { default: worker } = await import('../src/index');

      const message = createMockMessage();
      const batch = {
        queue: 'github-fetch-queue',
        messages: [message],
      } as MessageBatch;

      await worker.queue(batch, env);

      // Should still ack message even if some resources return 404
      expect(message.ack).toHaveBeenCalled();

      global.fetch = originalFetch;
    });

    it('should handle rate limiting', async () => {
      let attemptCount = 0;

      global.fetch = vi.fn(async (url: string) => {
        if (url.includes('/repos/user/test-repo')) {
          attemptCount++;
          if (attemptCount === 1) {
            return {
              ok: false,
              status: 429,
              statusText: 'Too Many Requests',
              headers: new Map([['X-RateLimit-Reset', String(Math.floor(Date.now() / 1000) + 1)]]),
              json: async () => ({}),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 1 }),
            headers: new Map(),
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => [],
          headers: new Map(),
        };
      });

      const { default: worker } = await import('../src/index');

      const message = createMockMessage();
      const batch = {
        queue: 'github-fetch-queue',
        messages: [message],
      } as MessageBatch;

      await worker.queue(batch, env);

      // Should have retried after rate limit
      expect(attemptCount).toBe(2);

      global.fetch = originalFetch;
    });
  });

  describe('R2 storage', () => {
    it('should save data to R2 with Hive partitioning', async () => {
      const mockRepoData = { id: 1, name: 'test-repo' };

      global.fetch = createMockFetch(
        new Map([
          ['/repos/user/test-repo', { ok: true, data: mockRepoData }],
          ['/issues', { ok: true, data: [] }],
          ['/pulls', { ok: true, data: [] }],
          ['/commits', { ok: true, data: [] }],
          ['/stargazers', { ok: true, data: [] }],
          ['/releases', { ok: true, data: [] }],
          ['/actions/runs', { ok: true, data: { workflow_runs: [] } }],
        ])
      );

      const { default: worker } = await import('../src/index');

      const message = createMockMessage();
      const batch = {
        queue: 'github-fetch-queue',
        messages: [message],
      } as MessageBatch;

      await worker.queue(batch, env);

      // Should have saved to R2
      expect(env.RAW_BUCKET.put).toHaveBeenCalled();

      // Verify Hive partition structure
      const putCalls = env.RAW_BUCKET.put.mock.calls;
      const firstCall = putCalls[0];
      const path = firstCall[0];

      // Should match pattern: sources/github/{resource}/year=YYYY/month=MM/day=DD/{uuid}.json
      expect(path).toMatch(
        /^sources\/github\/repositories\/year=\d{4}\/month=\d{2}\/day=\d{2}\/[a-f0-9-]+\.json$/
      );

      global.fetch = originalFetch;
    });

    it('should enrich data with metadata', async () => {
      const mockIssues = [{ id: 1, title: 'Issue 1' }];

      global.fetch = createMockFetch(
        new Map([
          ['/repos/user/test-repo', { ok: true, data: { id: 1 } }],
          ['/issues', { ok: true, data: mockIssues }],
          ['/pulls', { ok: true, data: [] }],
          ['/commits', { ok: true, data: [] }],
          ['/stargazers', { ok: true, data: [] }],
          ['/releases', { ok: true, data: [] }],
          ['/actions/runs', { ok: true, data: { workflow_runs: [] } }],
        ])
      );

      const { default: worker } = await import('../src/index');

      const message = createMockMessage();
      const batch = {
        queue: 'github-fetch-queue',
        messages: [message],
      } as MessageBatch;

      await worker.queue(batch, env);

      // Find the issues data in R2 puts
      const putCalls = env.RAW_BUCKET.put.mock.calls;
      const issuesCall = putCalls.find((call: any) => call[0].includes('/issues/'));

      expect(issuesCall).toBeDefined();

      const savedData = JSON.parse(issuesCall[1]);
      const firstRecord = savedData[0];

      // Should have metadata fields
      expect(firstRecord).toHaveProperty('_extracted_at');
      expect(firstRecord).toHaveProperty('_execution_id', 'exec-123');
      expect(firstRecord).toHaveProperty('_repository_full_name', 'user/test-repo');

      global.fetch = originalFetch;
    });

    it('should set correct content type and metadata', async () => {
      global.fetch = createMockFetch(
        new Map([
          ['/repos/user/test-repo', { ok: true, data: { id: 1 } }],
          ['/issues', { ok: true, data: [] }],
          ['/pulls', { ok: true, data: [] }],
          ['/commits', { ok: true, data: [] }],
          ['/stargazers', { ok: true, data: [] }],
          ['/releases', { ok: true, data: [] }],
          ['/actions/runs', { ok: true, data: { workflow_runs: [] } }],
        ])
      );

      const { default: worker } = await import('../src/index');

      const message = createMockMessage();
      const batch = {
        queue: 'github-fetch-queue',
        messages: [message],
      } as MessageBatch;

      await worker.queue(batch, env);

      // Check R2 put options
      const putCalls = env.RAW_BUCKET.put.mock.calls;
      const firstCall = putCalls[0];
      const options = firstCall[2];

      expect(options.httpMetadata.contentType).toBe('application/json');
      expect(options.customMetadata).toHaveProperty('resource');
      expect(options.customMetadata).toHaveProperty('record_count');
      expect(options.customMetadata).toHaveProperty('extracted_at');

      global.fetch = originalFetch;
    });
  });

  describe('Error handling', () => {
    it('should handle API errors and retry message', async () => {
      global.fetch = vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({}),
        headers: new Map(),
      }));

      const { default: worker } = await import('../src/index');

      const message = createMockMessage();
      const batch = {
        queue: 'github-fetch-queue',
        messages: [message],
      } as MessageBatch;

      await worker.queue(batch, env);

      // Should retry on error
      expect(message.retry).toHaveBeenCalled();
      expect(message.ack).not.toHaveBeenCalled();

      global.fetch = originalFetch;
    });

    it('should handle network errors', async () => {
      global.fetch = vi.fn(async () => {
        throw new Error('Network connection failed');
      });

      const { default: worker } = await import('../src/index');

      const message = createMockMessage();
      const batch = {
        queue: 'github-fetch-queue',
        messages: [message],
      } as MessageBatch;

      await worker.queue(batch, env);

      // Should retry the message
      expect(message.retry).toHaveBeenCalled();

      global.fetch = originalFetch;
    });
  });
});
