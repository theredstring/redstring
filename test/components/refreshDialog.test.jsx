import { render, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/services/SaveCoordinator.js', () => ({
  default: { isSaving: false, hasUnsavedChanges: vi.fn(() => false) },
}));

import useGraphStore from '../../src/store/graphStore.js';
import saveCoordinator from '../../src/services/SaveCoordinator.js';
import { useCanvasDialogStore } from '../../src/components/canvas/dialogs/canvasDialogs.js';
import * as refresh from '../../src/components/canvas/dialogs/refresh.js';
import RefreshDialog from '../../src/components/canvas/dialogs/RefreshDialog.jsx';

// Every Refresh button asks first, and the question names the open webs that
// aren't bookmarked and says when changes are still saving.

const makeGraph = (id, name, definingNodeIds = []) => ({
  id, name, description: '', instances: new Map(), edgeIds: [], groups: new Map(), definingNodeIds,
});

beforeEach(() => {
  useGraphStore.setState({
    graphs: new Map([
      ['g-kept', makeGraph('g-kept', 'Kept', ['p-kept'])],
      ['g-loose', makeGraph('g-loose', 'Loose', ['p-loose'])],
      ['g-bare', makeGraph('g-bare', '  ', [])],
      ['g-closed', makeGraph('g-closed', 'Closed', ['p-closed'])],
    ]),
    openGraphIds: ['g-kept', 'g-loose', 'g-bare'],
    activeGraphId: 'g-kept',
    savedNodeIds: new Set(['p-kept']),
  });
  saveCoordinator.isSaving = false;
  saveCoordinator.hasUnsavedChanges.mockReturnValue(false);
  useCanvasDialogStore.setState({ refreshDialog: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('refresh confirmation', () => {
  it('asks instead of reloading', () => {
    refresh.requestRefresh();
    expect(useCanvasDialogStore.getState().refreshDialog).toBeTruthy();
  });

  it('lists only open webs that are not bookmarked', () => {
    expect(refresh.describeRefresh()).toEqual({ unbookmarkedWebs: ['Loose', 'Untitled web'], stillSaving: false });
  });

  it('reports changes that are still saving', () => {
    saveCoordinator.hasUnsavedChanges.mockReturnValue(true);
    expect(refresh.describeRefresh().stillSaving).toBe(true);
    saveCoordinator.hasUnsavedChanges.mockReturnValue(false);
    saveCoordinator.isSaving = true;
    expect(refresh.describeRefresh().stillSaving).toBe(true);
  });

  it('names webs readably', () => {
    expect(refresh.listWebNames(['A'])).toBe('"A"');
    expect(refresh.listWebNames(['A', 'B'])).toBe('"A" and "B"');
    expect(refresh.listWebNames(['A', 'B', 'C'])).toBe('"A", "B" and "C"');
    expect(refresh.listWebNames(['A', 'B', 'C', 'D', 'E'])).toBe('"A", "B", "C" and 2 more');
  });

  it('shows the unbookmarked webs and closes on Cancel', () => {
    refresh.requestRefresh();
    const { getByText, queryByText } = render(<RefreshDialog />);
    expect(getByText('Refresh Redstring?')).toBeTruthy();
    expect(getByText(/2 open webs aren't bookmarked: "Loose" and "Untitled web"/)).toBeTruthy();
    expect(queryByText(/still saving/)).toBeNull();
    fireEvent.click(getByText('Cancel'));
    expect(useCanvasDialogStore.getState().refreshDialog).toBeNull();
  });

  it('says nothing extra when every open web is bookmarked and nothing is saving', () => {
    useGraphStore.setState({ openGraphIds: ['g-kept'] });
    refresh.requestRefresh();
    const { queryByText } = render(<RefreshDialog />);
    expect(queryByText(/bookmarked/)).toBeNull();
    expect(queryByText(/still saving/)).toBeNull();
  });

  it('warns when changes are still saving', () => {
    saveCoordinator.hasUnsavedChanges.mockReturnValue(true);
    refresh.requestRefresh();
    const { getByText } = render(<RefreshDialog />);
    expect(getByText(/Your latest changes are still saving/)).toBeTruthy();
  });

  it('shows nothing until asked', () => {
    const { container } = render(<RefreshDialog />);
    expect(container.textContent).toBe('');
  });
});
