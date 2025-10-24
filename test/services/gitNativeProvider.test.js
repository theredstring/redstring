import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  SemanticProvider, 
  GitHubSemanticProvider, 
  GiteaSemanticProvider, 
  SemanticProviderFactory 
} from '../../src/services/gitNativeProvider.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('Git-Native Semantic Web Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SemanticProvider Base Class', () => {
    it('should create a provider with basic configuration', () => {
      const provider = new SemanticProvider({
        name: 'Test Provider',
        rootUrl: 'https://test.com/api',
        authMechanism: 'oauth'
      });

      expect(provider.name).toBe('Test Provider');
      expect(provider.rootUrl).toBe('https://test.com/api');
      expect(provider.authMechanism).toBe('oauth');
    });

    it('should throw error for unimplemented methods', async () => {
      const provider = new SemanticProvider({
        name: 'Test Provider',
        rootUrl: 'https://test.com/api',
        authMechanism: 'oauth'
      });

      await expect(provider.authenticate()).rejects.toThrow('authenticate() must be implemented by provider');
      await expect(provider.createSemanticSpace('test')).rejects.toThrow('createSemanticSpace() must be implemented by provider');
      await expect(provider.writeSemanticFile('test', 'content')).rejects.toThrow('writeSemanticFile() must be implemented by provider');
    });
  });

  describe('GitHubSemanticProvider', () => {
    const mockConfig = {
      user: 'testuser',
      repo: 'testrepo',
      token: 'ghp_testtoken123',
      semanticPath: 'semantic'
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should create GitHub provider with correct configuration', () => {
      const provider = new GitHubSemanticProvider(mockConfig);

      expect(provider.name).toBe('GitHub');
      expect(provider.user).toBe('testuser');
      expect(provider.repo).toBe('testrepo');
      expect(provider.token).toBe('ghp_testtoken123');
      expect(provider.semanticPath).toBe('semantic');
      expect(provider.rootUrl).toBe('https://api.github.com/repos/testuser/testrepo/contents');
    });

    it('should authenticate successfully with valid token', async () => {
      const provider = new GitHubSemanticProvider(mockConfig);
      const auth = await provider.authenticate();

      expect(auth).toEqual({
        token: 'ghp_testtoken123',
        type: 'oauth'
      });
    });

    it('should throw error for authentication without token', async () => {
      const provider = new GitHubSemanticProvider({
        ...mockConfig,
        token: null
      });

      await expect(provider.authenticate()).rejects.toThrow('GitHub token required for authentication');
    });

    it('should write semantic file successfully', async () => {
      const provider = new GitHubSemanticProvider(mockConfig);
      
      // Mock successful file write
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sha: 'abc123' })
      });

      // Mock file existence check
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sha: 'abc123' })
      });

      const result = await provider.writeSemanticFile('test-concept', 'test content');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/testuser/testrepo/contents/semantic/test-concept.ttl',
        expect.objectContaining({
          method: 'PUT',
          headers: {
            'Authorization': 'token ghp_testtoken123',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: 'Update test-concept semantic data',
            content: btoa('test content'),
            sha: 'abc123'
          })
        })
      );
    });

    it('should read semantic file successfully', async () => {
      const provider = new GitHubSemanticProvider(mockConfig);
      
      // Mock file info response
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: btoa('test content'),
          sha: 'abc123'
        })
      });

      const content = await provider.readSemanticFile('test-concept');

      expect(content).toBe('test content');
      expect(fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/testuser/testrepo/contents/semantic/test-concept.ttl',
        expect.objectContaining({
          headers: {
            'Authorization': 'token ghp_testtoken123'
          }
        })
      );
    });

    it('should create semantic space with standard structure', async () => {
      const provider = new GitHubSemanticProvider(mockConfig);
      
      // Mock multiple file writes
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ sha: 'abc123' })
      });

      const spaceInfo = await provider.createSemanticSpace('test-space');

      expect(spaceInfo.name).toBe('test-space');
      expect(spaceInfo.url).toBe('https://github.com/testuser/testrepo/tree/main/semantic/test-space');
      expect(spaceInfo.apiUrl).toBe('https://api.github.com/repos/testuser/testrepo/contents/semantic/test-space');
      expect(spaceInfo.createdAt).toBeDefined();
    });

    it('should check availability successfully', async () => {
      const provider = new GitHubSemanticProvider(mockConfig);
      
      global.fetch.mockResolvedValueOnce({
        ok: true
      });

      const isAvailable = await provider.isAvailable();

      expect(isAvailable).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/testuser/testrepo',
        expect.objectContaining({
          headers: {
            'Authorization': 'token ghp_testtoken123',
            'Accept': 'application/vnd.github.v3+json'
          }
        })
      );
    });

    it('should get status information', async () => {
      const provider = new GitHubSemanticProvider(mockConfig);
      
      global.fetch.mockResolvedValueOnce({
        ok: true
      });

      const status = await provider.getStatus();

      expect(status).toEqual({
        provider: 'github',
        available: true,
        user: 'testuser',
        repo: 'testrepo',
        semanticPath: 'semantic',
        lastChecked: expect.any(String)
      });
    });
  });

  describe('GiteaSemanticProvider', () => {
    const mockConfig = {
      endpoint: 'https://git.example.com',
      user: 'testuser',
      repo: 'testrepo',
      token: 'testtoken123',
      semanticPath: 'knowledge'
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should create Gitea provider with correct configuration', () => {
      const provider = new GiteaSemanticProvider(mockConfig);

      expect(provider.name).toBe('Self-Hosted Gitea');
      expect(provider.endpoint).toBe('https://git.example.com');
      expect(provider.user).toBe('testuser');
      expect(provider.repo).toBe('testrepo');
      expect(provider.token).toBe('testtoken123');
      expect(provider.semanticPath).toBe('knowledge');
      expect(provider.rootUrl).toBe('https://git.example.com/api/v1/repos/testuser/testrepo/contents');
    });

    it('should authenticate successfully with valid token', async () => {
      const provider = new GiteaSemanticProvider(mockConfig);
      const auth = await provider.authenticate();

      expect(auth).toEqual({
        token: 'testtoken123',
        type: 'token'
      });
    });

    it('should write semantic file successfully', async () => {
      const provider = new GiteaSemanticProvider(mockConfig);
      
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sha: 'abc123' })
      });

      const result = await provider.writeSemanticFile('test-concept', 'test content');

      expect(fetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/testuser/testrepo/contents/knowledge/test-concept.ttl',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'token testtoken123',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: 'Update test-concept semantic data',
            content: btoa('test content'),
            branch: 'main'
          })
        })
      );
    });

    it('should read semantic file successfully', async () => {
      const provider = new GiteaSemanticProvider(mockConfig);
      
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: btoa('test content'),
          sha: 'abc123'
        })
      });

      const content = await provider.readSemanticFile('test-concept');

      expect(content).toBe('test content');
      expect(fetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/repos/testuser/testrepo/contents/knowledge/test-concept.ttl?ref=main',
        expect.objectContaining({
          headers: {
            'Authorization': 'token testtoken123'
          }
        })
      );
    });

    it('should check availability successfully', async () => {
      const provider = new GiteaSemanticProvider(mockConfig);
      
      global.fetch.mockResolvedValueOnce({
        ok: true
      });

      const isAvailable = await provider.isAvailable();

      expect(isAvailable).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'https://git.example.com/api/v1/version',
        expect.objectContaining({
          headers: {
            'Authorization': 'token testtoken123'
          }
        })
      );
    });
  });

  describe('SemanticProviderFactory', () => {
    it('should create GitHub provider', () => {
      const config = {
        type: 'github',
        user: 'testuser',
        repo: 'testrepo',
        token: 'ghp_testtoken123'
      };

      const provider = SemanticProviderFactory.createProvider(config);

      expect(provider).toBeInstanceOf(GitHubSemanticProvider);
      expect(provider.user).toBe('testuser');
      expect(provider.repo).toBe('testrepo');
    });

    it('should create Gitea provider', () => {
      const config = {
        type: 'gitea',
        endpoint: 'https://git.example.com',
        user: 'testuser',
        repo: 'testrepo',
        token: 'testtoken123'
      };

      const provider = SemanticProviderFactory.createProvider(config);

      expect(provider).toBeInstanceOf(GiteaSemanticProvider);
      expect(provider.endpoint).toBe('https://git.example.com');
      expect(provider.user).toBe('testuser');
    });

    it('should throw error for unknown provider type', () => {
      const config = {
        type: 'unknown',
        user: 'testuser',
        repo: 'testrepo'
      };

      expect(() => SemanticProviderFactory.createProvider(config))
        .toThrow('Unknown provider type: unknown');
    });

    it('should return available providers', () => {
      const providers = SemanticProviderFactory.getAvailableProviders();

      expect(providers).toHaveLength(2);
      expect(providers[0]).toEqual({
        type: 'github',
        name: 'GitHub',
        description: 'GitHub-hosted semantic spaces',
        authMechanism: 'oauth',
        configFields: ['user', 'repo', 'token', 'semanticPath']
      });
      expect(providers[1]).toEqual({
        type: 'gitea',
        name: 'Self-Hosted Gitea',
        description: 'Self-hosted Gitea instance',
        authMechanism: 'token',
        configFields: ['endpoint', 'user', 'repo', 'token', 'semanticPath']
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle GitHub API errors gracefully', async () => {
      const provider = new GitHubSemanticProvider({
        user: 'testuser',
        repo: 'testrepo',
        token: 'ghp_testtoken123'
      });

      // Mock file existence check to return null (file doesn't exist)
      global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });

      // Mock the actual write operation to fail
      global.fetch.mockResolvedValueOnce({ ok: false, text: () => Promise.resolve('Not Found') });

      await expect(provider.writeSemanticFile('test', 'content'))
        .rejects.toThrow('GitHub API error: Not Found');
    });

    it('should handle Gitea API errors gracefully', async () => {
      const provider = new GiteaSemanticProvider({
        endpoint: 'https://git.example.com',
        user: 'testuser',
        repo: 'testrepo',
        token: 'testtoken123'
      });

      global.fetch.mockResolvedValueOnce({ ok: false, text: () => Promise.resolve('Unauthorized') });

      await expect(provider.writeSemanticFile('test', 'content'))
        .rejects.toThrow('Gitea API error: Unauthorized');
    });

    it('should handle network errors gracefully', async () => {
      const provider = new GitHubSemanticProvider({
        user: 'testuser',
        repo: 'testrepo',
        token: 'ghp_testtoken123'
      });

      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      const isAvailable = await provider.isAvailable();
      expect(isAvailable).toBe(false);
    });
  });

  describe('Export/Import Functionality', () => {
    it('should export full graph from GitHub', async () => {
      const provider = new GitHubSemanticProvider({
        user: 'testuser',
        repo: 'testrepo',
        token: 'ghp_testtoken123'
      });

      // Mock file listing
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { path: 'semantic/vocabulary/concepts/test.ttl', name: 'test.ttl' }
        ])
      });

      // Mock file content
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: btoa('test content'),
          sha: 'abc123'
        })
      });

      const archive = await provider.exportFullGraph();

      expect(archive.provider).toBe('github');
      expect(archive.user).toBe('testuser');
      expect(archive.repo).toBe('testrepo');
      expect(archive.exportedAt).toBeDefined();
      expect(archive.files).toHaveProperty('semantic/vocabulary/concepts/test.ttl');
    });

    it('should import full graph to GitHub', async () => {
      const provider = new GitHubSemanticProvider({
        user: 'testuser',
        repo: 'testrepo',
        token: 'ghp_testtoken123'
      });

      const archive = {
        provider: 'github',
        user: 'testuser',
        repo: 'testrepo',
        exportedAt: new Date().toISOString(),
        files: {
          'semantic/vocabulary/concepts/test.ttl': 'test content'
        }
      };

      // Mock file write
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ sha: 'abc123' })
      });

      await expect(provider.importFullGraph(archive)).resolves.not.toThrow();
    });

    it('should reject import of wrong provider type', async () => {
      const provider = new GitHubSemanticProvider({
        user: 'testuser',
        repo: 'testrepo',
        token: 'ghp_testtoken123'
      });

      const archive = {
        provider: 'gitea',
        files: {}
      };

      await expect(provider.importFullGraph(archive))
        .rejects.toThrow('Archive is not from GitHub provider');
    });
  });
}); 