import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock environment
const createMockEnv = () => {
  const queueMessages: any[] = [];
  const kvStore: Map<string, string> = new Map();
  const analyticsData: any[] = [];

  return {
    GITHUB_TOKEN: 'test-token',
    GITHUB_QUEUE: {
      sendBatch: vi.fn(async (messages: any[]) => {
        queueMessages.push(...messages);
      }),
      _messages: queueMessages,
    },
    METADATA_KV: {
      put: vi.fn(async (key: string, value: string, options?: any) => {
        kvStore.set(key, value);
      }),
      get: vi.fn(async (key: string, type?: string) => {
        const value = kvStore.get(key);
        if (!value) return null;
        return type === 'json' ? JSON.parse(value) : value;
      }),
      _store: kvStore,
    },
    ANALYTICS: {
      writeDataPoint: vi.fn((data: any) => {
        analyticsData.push(data);
      }),
      _data: analyticsData,
    },
  };
};

// Mock fetch
const createMockFetch = (responses: any[] = []) => {
  let callCount = 0;
  return vi.fn(async (url: string, options?: any) => {
    const response = responses[callCount] || { ok: true, json: async () => [], headers: new Map() };
    callCount++;

    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      statusText: response.statusText ?? 'OK',
      json: async () => response.data || [],
      headers: new Map(Object.entries(response.headers || {})),
    };
  });
};

describe('GitHub Scheduler Worker', () => {
  let env: any;
  let originalFetch: any;

  beforeEach(() => {
    env = createMockEnv();
    originalFetch = global.fetch;
  });

  describe('Fetch repositories', () => {
    it('should fetch repositories from GitHub API', async () => {
      const mockRepos = [
        {
          id: 1,
          full_name: 'user/repo1',
          name: 'repo1',
          owner: { login: 'user' },
          private: false,
        },
        {
          id: 2,
          full_name: 'user/repo2',
          name: 'repo2',
          owner: { login: 'user' },
          private: true,
        },
      ];

      global.fetch = createMockFetch([
        { ok: true, data: mockRepos, headers: {} },
      ]);

      const { default: worker } = await import('../src/index');

      const event = {
        cron: '0 2 * * *',
        scheduledTime: Date.now(),
      } as ScheduledEvent;

      await worker.scheduled(event, env, {} as ExecutionContext);

      // Verify fetch was called with correct parameters
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.github.com/user/repos'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'token test-token',
          }),
        })
      );

      global.fetch = originalFetch;
    });

    it('should handle pagination correctly', async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        full_name: `user/repo${i + 1}`,
        name: `repo${i + 1}`,
        owner: { login: 'user' },
        private: false,
      }));

      const page2 = Array.from({ length: 50 }, (_, i) => ({
        id: i + 101,
        full_name: `user/repo${i + 101}`,
        name: `repo${i + 101}`,
        owner: { login: 'user' },
        private: false,
      }));

      global.fetch = createMockFetch([
        {
          ok: true,
          data: page1,
          headers: { Link: '<...>; rel="next"' },
        },
        {
          ok: true,
          data: page2,
          headers: {},
        },
      ]);

      const { default: worker } = await import('../src/index');

      const event = {
        cron: '0 2 * * *',
        scheduledTime: Date.now(),
      } as ScheduledEvent;

      await worker.scheduled(event, env, {} as ExecutionContext);

      // Should have fetched 2 pages
      expect(global.fetch).toHaveBeenCalledTimes(2);

      // Should have sent all 150 repositories to queue
      expect(env.GITHUB_QUEUE._messages.length).toBe(150);

      global.fetch = originalFetch;
    });

    it('should handle rate limiting with retry', async () => {
      const mockRepos = [
        { id: 1, full_name: 'user/repo1', name: 'repo1', owner: { login: 'user' }, private: false },
      ];

      let attemptCount = 0;
      global.fetch = vi.fn(async () => {
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
          statusText: 'OK',
          headers: new Map(),
          json: async () => mockRepos,
        };
      });

      const { default: worker } = await import('../src/index');

      const event = {
        cron: '0 2 * * *',
        scheduledTime: Date.now(),
      } as ScheduledEvent;

      await worker.scheduled(event, env, {} as ExecutionContext);

      // Should have retried after rate limit
      expect(global.fetch).toHaveBeenCalledTimes(2);

      global.fetch = originalFetch;
    });
  });

  describe('Queue message sending', () => {
    it('should send repositories to queue in batches', async () => {
      const mockRepos = Array.from({ length: 250 }, (_, i) => ({
        id: i + 1,
        full_name: `user/repo${i + 1}`,
        name: `repo${i + 1}`,
        owner: { login: 'user' },
        private: false,
      }));

      global.fetch = createMockFetch([
        { ok: true, data: mockRepos, headers: {} },
      ]);

      const { default: worker } = await import('../src/index');

      const event = {
        cron: '0 2 * * *',
        scheduledTime: Date.now(),
      } as ScheduledEvent;

      await worker.scheduled(event, env, {} as ExecutionContext);

      // Should send in batches of 100
      expect(env.GITHUB_QUEUE.sendBatch).toHaveBeenCalledTimes(3);

      // Total messages should be 250
      expect(env.GITHUB_QUEUE._messages.length).toBe(250);

      // Verify message structure
      const firstMessage = env.GITHUB_QUEUE._messages[0];
      expect(firstMessage.body).toHaveProperty('repository_id');
      expect(firstMessage.body).toHaveProperty('repository_full_name');
      expect(firstMessage.body).toHaveProperty('execution_id');

      global.fetch = originalFetch;
    });
  });

  describe('Metadata storage', () => {
    it('should store execution metadata in KV', async () => {
      const mockRepos = [
        { id: 1, full_name: 'user/repo1', name: 'repo1', owner: { login: 'user' }, private: false },
      ];

      global.fetch = createMockFetch([
        { ok: true, data: mockRepos, headers: {} },
      ]);

      const { default: worker } = await import('../src/index');

      const event = {
        cron: '0 2 * * *',
        scheduledTime: Date.now(),
      } as ScheduledEvent;

      await worker.scheduled(event, env, {} as ExecutionContext);

      // Should have stored metadata twice (initial and final)
      expect(env.METADATA_KV.put).toHaveBeenCalledTimes(2);

      // Verify final metadata structure
      const kvEntries = Array.from(env.METADATA_KV._store.entries());
      const [key, value] = kvEntries[0];

      expect(key).toMatch(/^execution:/);

      const metadata = JSON.parse(value);
      expect(metadata).toHaveProperty('execution_id');
      expect(metadata).toHaveProperty('started_at');
      expect(metadata).toHaveProperty('repositories_count', 1);
      expect(metadata).toHaveProperty('status', 'completed');
      expect(metadata).toHaveProperty('ended_at');

      global.fetch = originalFetch;
    });

    it('should update metadata on error', async () => {
      global.fetch = vi.fn(async () => {
        throw new Error('Network error');
      });

      const { default: worker } = await import('../src/index');

      const event = {
        cron: '0 2 * * *',
        scheduledTime: Date.now(),
      } as ScheduledEvent;

      await expect(
        worker.scheduled(event, env, {} as ExecutionContext)
      ).rejects.toThrow('Network error');

      // Should have stored error metadata
      const kvEntries = Array.from(env.METADATA_KV._store.entries());
      const [, value] = kvEntries[0];

      const metadata = JSON.parse(value);
      expect(metadata.status).toBe('failed');
      expect(metadata).toHaveProperty('error');

      global.fetch = originalFetch;
    });
  });

  describe('Analytics tracking', () => {
    it('should write success analytics', async () => {
      const mockRepos = [
        { id: 1, full_name: 'user/repo1', name: 'repo1', owner: { login: 'user' }, private: false },
      ];

      global.fetch = createMockFetch([
        { ok: true, data: mockRepos, headers: {} },
      ]);

      const { default: worker } = await import('../src/index');

      const event = {
        cron: '0 2 * * *',
        scheduledTime: Date.now(),
      } as ScheduledEvent;

      await worker.scheduled(event, env, {} as ExecutionContext);

      expect(env.ANALYTICS.writeDataPoint).toHaveBeenCalledWith(
        expect.objectContaining({
          blobs: expect.arrayContaining(['scheduler_success']),
          doubles: [1],
        })
      );

      global.fetch = originalFetch;
    });

    it('should write error analytics on failure', async () => {
      global.fetch = vi.fn(async () => {
        throw new Error('Test error');
      });

      const { default: worker } = await import('../src/index');

      const event = {
        cron: '0 2 * * *',
        scheduledTime: Date.now(),
      } as ScheduledEvent;

      await expect(
        worker.scheduled(event, env, {} as ExecutionContext)
      ).rejects.toThrow('Test error');

      expect(env.ANALYTICS.writeDataPoint).toHaveBeenCalledWith(
        expect.objectContaining({
          blobs: expect.arrayContaining(['scheduler_error']),
        })
      );

      global.fetch = originalFetch;
    });
  });

  describe('HTTP endpoints', () => {
    it('should handle GET /status/:execution_id', async () => {
      const { default: worker } = await import('../src/index');

      // Store mock metadata
      const mockMetadata = {
        execution_id: 'test-123',
        started_at: new Date().toISOString(),
        repositories_count: 5,
        status: 'completed',
      };

      await env.METADATA_KV.put('execution:test-123', JSON.stringify(mockMetadata));

      const request = new Request('http://localhost/status/test-123', {
        method: 'GET',
      });

      const response = await worker.fetch(request, env);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual(mockMetadata);
    });

    it('should return 404 for non-existent execution', async () => {
      const { default: worker } = await import('../src/index');

      const request = new Request('http://localhost/status/nonexistent', {
        method: 'GET',
      });

      const response = await worker.fetch(request, env);

      expect(response.status).toBe(404);
    });

    it('should handle POST /trigger for manual execution', async () => {
      const mockRepos = [
        { id: 1, full_name: 'user/repo1', name: 'repo1', owner: { login: 'user' }, private: false },
      ];

      global.fetch = createMockFetch([
        { ok: true, data: mockRepos, headers: {} },
      ]);

      const { default: worker } = await import('../src/index');

      const request = new Request('http://localhost/trigger', {
        method: 'POST',
      });

      const response = await worker.fetch(request, env);

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('triggered successfully');

      global.fetch = originalFetch;
    });
  });
});
