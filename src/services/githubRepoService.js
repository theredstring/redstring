/**
 * GitHub repository listing/creation over the user's OAuth token, shared
 * between RepositorySelectionModal and the onboarding GitHub wizard.
 * OAuth is required for browsing/creating — the GitHub App token is only
 * used for backend sync operations.
 */
import { persistentAuth } from './persistentAuth.js';

const { warn: __nativeWarn } = console;
const grWarn = (...args) => __nativeWarn.call(console, '[GitHubRepoService]', ...args);

const REPOS_URL = 'https://api.github.com/user/repos?sort=updated&per_page=100';

/**
 * List the user's repositories (most recently updated first). Handles a
 * one-shot token refresh + retry on 401. Throws with user-facing messages
 * matching the existing panel behavior.
 */
export async function listUserRepos() {
  let token = await persistentAuth.getAccessToken();
  if (!token) {
    throw new Error('GitHub OAuth required to browse repositories. Please connect OAuth in Accounts & Access.');
  }

  const response = await fetch(REPOS_URL, {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorMessage = errorBody?.message || errorBody?.error || '';

    if (response.status === 401) {
      // Try to refresh OAuth token, then retry once
      try {
        await persistentAuth.refreshAccessToken?.();
        token = await persistentAuth.getAccessToken();
        if (!token) throw new Error('no token after refresh');

        const retryResponse = await fetch(REPOS_URL, {
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });
        if (!retryResponse.ok) throw new Error('retry failed');
        return retryResponse.json();
      } catch {
        throw new Error('OAuth authentication expired. Please reconnect in Accounts & Access.');
      }
    } else if (response.status === 403) {
      // 403 could be rate limiting or insufficient permissions
      if (errorMessage.includes('rate limit')) {
        throw new Error('GitHub API rate limit exceeded. Please wait a few minutes and try again.');
      } else if (errorMessage.includes('scope')) {
        throw new Error(`Insufficient permissions. ${errorMessage}`);
      }
      throw new Error(`Access forbidden (403). ${errorMessage || 'Your token may lack necessary permissions (repo scope required).'}`);
    }
    throw new Error(`Failed to load repositories: ${response.status}. ${errorMessage}`);
  }

  return response.json();
}

/**
 * Create a repository on the user's account, tagged with the
 * `redstring-universe` topic (best-effort) so the public ecosystem stays
 * discoverable via topic search.
 *
 * If the name is already taken (GitHub 422 "name already exists"), the
 * existing repo is fetched and returned with `existed: true` so callers can
 * link it instead of failing.
 *
 * Returns { repo, existed }.
 */
export async function createRepository({ name, isPrivate = true }) {
  const trimmedName = (name || '').trim();
  if (!trimmedName) {
    throw new Error('Repository name is required.');
  }

  const token = await persistentAuth.getAccessToken();
  if (!token) {
    throw new Error('GitHub OAuth required to create repositories. Please connect OAuth in Accounts & Access.');
  }

  const response = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: trimmedName,
      private: isPrivate,
      auto_init: true
    })
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message = errorBody?.message || `Failed to create repository (status ${response.status})`;
    const nameExists = response.status === 422 && JSON.stringify(errorBody).toLowerCase().includes('already exists');

    if (nameExists) {
      // The repo already exists on this account — fetch and reuse it.
      const login = persistentAuth.oauthCache?.user?.login;
      if (login) {
        const existingResp = await fetch(`https://api.github.com/repos/${login}/${trimmedName}`, {
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });
        if (existingResp.ok) {
          const repo = await existingResp.json();
          return { repo, existed: true };
        }
      }
      throw new Error(`A repository named "${trimmedName}" already exists but could not be linked. Pick it from the existing-repository list instead.`);
    }
    throw new Error(message);
  }

  const repo = await response.json();

  // Tag with `redstring-universe` topic. Best-effort — failure to set
  // topics must not break repo creation.
  try {
    const ownerLogin = repo.owner?.login || repo.owner?.name;
    if (ownerLogin && repo.name) {
      await fetch(`https://api.github.com/repos/${ownerLogin}/${repo.name}/topics`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ names: ['redstring-universe'] })
      });
    }
  } catch (topicErr) {
    grWarn('Failed to set redstring-universe topic:', topicErr);
  }

  return { repo, existed: false };
}
