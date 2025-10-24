import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitHubSemanticProvider, GiteaSemanticProvider } from '../../src/services/gitNativeProvider.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('Provider raw file IO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GitHub writeFileRaw/readFileRaw', () => {
    const cfg = { user: 'u', repo: 'r', token: 't' };
    const root = 'https://api.github.com/repos/u/r/contents';

    it('creates new file when not exists (404 then PUT)', async () => {
      const p = new GitHubSemanticProvider(cfg);

      // First: getFileInfo -> 404
      fetch.mockResolvedValueOnce({ status: 404, ok: false });
      // Then: PUT succeeds
      fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sha: 'newsha' }) });

      const content = 'hello world';
      await p.writeFileRaw('universe.redstring', content);

      // Check PUT call
      const putCall = fetch.mock.calls[1];
      expect(putCall[0]).toBe(`${root}/universe.redstring`);
      const body = JSON.parse(putCall[1].body);
      expect(body.message).toContain('Update universe.redstring');
      // base64 of ascii matches btoa
      expect(body.content).toBe(btoa(content));
    });

    it('updates existing file when sha present (GET then PUT with sha)', async () => {
      const p = new GitHubSemanticProvider(cfg);
      // getFileInfo returns existing sha
      fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sha: 'abc123' }) });
      // PUT succeeds
      fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sha: 'def456' }) });

      await p.writeFileRaw('universe.redstring', 'x');
      const putBody = JSON.parse(fetch.mock.calls[1][1].body);
      expect(putBody.sha).toBe('abc123');
    });

    it('readFileRaw decodes UTF-8 correctly', async () => {
      const p = new GitHubSemanticProvider(cfg);
      const text = 'caf\u00E9 \uD83C\uDF10'; // café 🌐
      const b64 = btoa(unescape(encodeURIComponent(text)));
      // getFileInfo returns content
      fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ content: b64 }) });

      const result = await p.readFileRaw('universe.redstring');
      expect(result).toBe(text);
    });
  });

  describe('Gitea writeFileRaw/readFileRaw', () => {
    const cfg = { endpoint: 'https://git.example.com', user: 'u', repo: 'r', token: 't' };
    const root = 'https://git.example.com/api/v1/repos/u/r/contents';

    it('creates new file (404 then POST)', async () => {
      const p = new GiteaSemanticProvider(cfg);
      // getFileInfo -> 404
      fetch.mockResolvedValueOnce({ status: 404, ok: false });
      // POST ok
      fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sha: 'new' }) });

      await p.writeFileRaw('universe.redstring', 'json');
      const postCall = fetch.mock.calls[1];
      expect(postCall[0]).toBe(`${root}/universe.redstring`);
      expect(postCall[1].method).toBe('POST');
      const body = JSON.parse(postCall[1].body);
      expect(body.branch).toBe('main');
      expect(body.sha).toBeUndefined();
    });

    it('updates existing file (GET then PUT with sha)', async () => {
      const p = new GiteaSemanticProvider(cfg);
      // getFileInfo -> has sha
      fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sha: 'abc' }) });
      // PUT ok
      fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sha: 'def' }) });

      await p.writeFileRaw('universe.redstring', 'json');
      const putCall = fetch.mock.calls[1];
      expect(putCall[1].method).toBe('PUT');
      const body = JSON.parse(putCall[1].body);
      expect(body.sha).toBe('abc');
    });

    it('readFileRaw decodes UTF-8 correctly', async () => {
      const p = new GiteaSemanticProvider(cfg);
      const text = 'привет мир';
      const b64 = btoa(unescape(encodeURIComponent(text)));
      // getFileInfo
      fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ content: b64 }) });
      const out = await p.readFileRaw('universe.redstring');
      expect(out).toBe(text);
    });
  });
});


