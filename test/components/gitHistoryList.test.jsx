/**
 * The Git tab in the left panel's History view.
 *
 * This is the browsable half of the recovery story. The automatic offer only
 * fires when a universe opens empty; this is what someone can reach for
 * deliberately, before or after that, and it has to be honest about two things:
 * a size it could not read is not "empty", and a listing it could not fetch is
 * not "no versions exist".
 */
import React from 'react';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const backend = {
  getUniverse: vi.fn(),
  getActiveUniverse: vi.fn(),
  listUniverseHistory: vi.fn(),
  describeUniverseVersion: vi.fn(),
  restoreUniverseVersion: vi.fn()
};

vi.mock('../../src/services/universeBackend.js', () => ({
  default: backend,
  universeBackend: backend
}));

const GitHistoryList = (await import('../../src/components/panel/views/GitHistoryList.jsx')).default;

const linkedUniverse = {
  slug: 'claude-s-chambers-2',
  name: "Claude's Chambers",
  gitRepo: { enabled: true, linkedRepo: { user: 'grantiguess', repo: 'Ontologies' } }
};

/** The real incident, as the commits endpoint reports it. */
const INCIDENT = [
  { sha: 'd4dc28ce', date: '2026-09-13T03:45:53Z', message: 'Update claude-s-chambers-2', size: 16488 },
  { sha: 'c66c761e', date: '2026-09-12T21:35:29Z', message: 'Update claude-s-chambers-2', size: 10010 },
  { sha: 'c11c2089', date: '2026-09-12T21:16:01Z', message: 'Update claude-s-chambers-2', size: 6916496 }
];

describe('GitHistoryList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backend.getActiveUniverse.mockReturnValue(linkedUniverse);
    backend.getUniverse.mockReturnValue(linkedUniverse);
    backend.listUniverseHistory.mockResolvedValue(INCIDENT);
    backend.describeUniverseVersion.mockResolvedValue({ sha: 'c11c2089', nodeCount: 1822, graphCount: 191 });
    backend.restoreUniverseVersion.mockResolvedValue({ nodeCount: 1822, graphCount: 191 });
  });
  afterEach(cleanup);

  it('makes the wipe legible from the size column alone', async () => {
    render(<GitHistoryList />);

    // 6916496 bytes next to 16488 bytes: the collapse is readable without
    // opening a single revision, which is the whole point of the column.
    await screen.findByText('6.6 MB');
    expect(screen.getByText('16.1 KB')).toBeTruthy();
    expect(screen.getByText('9.8 KB')).toBeTruthy();
  });

  it('marks only the newest revision as current', async () => {
    const { container } = render(<GitHistoryList />);
    await screen.findByText('6.6 MB');

    const heads = container.querySelectorAll('.git-revision.head');
    expect(heads).toHaveLength(1);
    expect(heads[0].textContent).toContain('16.1 KB');
  });

  it('reads the universe it was pointed at, not just the active one', async () => {
    const other = { ...linkedUniverse, slug: 'other', name: 'Other' };
    backend.getUniverse.mockReturnValue(other);

    render(<GitHistoryList universeSlug="other" />);

    await waitFor(() => expect(backend.listUniverseHistory).toHaveBeenCalled());
    expect(backend.listUniverseHistory.mock.calls[0][0]).toBe(other);
    expect(backend.getActiveUniverse).not.toHaveBeenCalled();
  });

  it('says there is no repository rather than showing an empty list', async () => {
    backend.getActiveUniverse.mockReturnValue({ slug: 'local-only', name: 'Local Only' });
    render(<GitHistoryList />);

    expect(screen.getByText('No repository linked')).toBeTruthy();
    expect(backend.listUniverseHistory).not.toHaveBeenCalled();
  });

  it('never reports a failed listing as "no versions"', async () => {
    backend.listUniverseHistory.mockResolvedValue([]);
    render(<GitHistoryList />);

    // "No versions FOUND" — the distinction matters when the thing being
    // advised on is whether the user's data still exists.
    await screen.findByText(/No versions found/i);
  });

  it('shows the size it already knows while the counts are still being read', async () => {
    let resolveCounts;
    backend.describeUniverseVersion.mockReturnValue(new Promise((r) => { resolveCounts = r; }));

    render(<GitHistoryList />);
    fireEvent.click(await screen.findByText('6.6 MB'));

    // The confirm stands on the size rather than a spinner or "? things":
    // the size now appears twice, once in the list and once in the dialog.
    await screen.findByText('Restore this version');
    expect(screen.getAllByText('6.6 MB')).toHaveLength(2);

    resolveCounts({ sha: 'c11c2089', nodeCount: 1822, graphCount: 191 });
    await screen.findByText('1,822 things · 191 webs');
  });

  it('restores the revision that was clicked', async () => {
    render(<GitHistoryList />);
    fireEvent.click(await screen.findByText('6.6 MB'));

    const confirm = await screen.findByText('Restore');
    fireEvent.click(confirm);

    await waitFor(() => expect(backend.restoreUniverseVersion).toHaveBeenCalled());
    const [slug, sha] = backend.restoreUniverseVersion.mock.calls[0];
    expect(slug).toBe('claude-s-chambers-2');
    expect(sha).toBe('c11c2089');
  });

  it('re-reads the listing after a restore, since the restore is itself a commit', async () => {
    render(<GitHistoryList />);
    fireEvent.click(await screen.findByText('6.6 MB'));
    fireEvent.click(await screen.findByText('Restore'));

    await waitFor(() => expect(backend.listUniverseHistory).toHaveBeenCalledTimes(2));
  });

  it('keeps the dialog closed until a revision is chosen', async () => {
    render(<GitHistoryList />);
    await screen.findByText('6.6 MB');
    expect(screen.queryByText('Restore this version')).toBeNull();
  });
});
