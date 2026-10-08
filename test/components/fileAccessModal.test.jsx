import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import FileAccessModal from '../../src/components/modals/FileAccessModal.jsx';
import ModalGallery from '../../src/components/settings/ModalGallery.jsx';

/**
 * The modal that replaced a Grant Access button buried in one universe's card.
 * What it must get right is the one action it offers: what it is called at
 * each step, and that it closes itself only when there is nothing left to do.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const FOLDER = { name: 'Redstring', state: 'prompt' };
const FILE = { name: 'nerd.redstring', state: 'prompt', isSourceOfTruth: true };

const renderModal = (props = {}) => render(
  <FileAccessModal
    isVisible
    onClose={() => {}}
    access={{ universeName: 'Nerd', folder: FOLDER, file: FILE }}
    onGrant={async () => {}}
    {...props}
  />
);

describe('FileAccessModal', () => {
  it('names the universe it could not load and everything that is locked', () => {
    renderModal();
    expect(screen.getByText('Reopen Nerd')).toBeTruthy();
    expect(screen.getByText('Redstring')).toBeTruthy();
    expect(screen.getByText('nerd.redstring')).toBeTruthy();
    expect(screen.getAllByText('Locked')).toHaveLength(2);
    expect(screen.getByText('Allow access')).toBeTruthy();
  });

  it('names the one thing left when the browser wants a second click', () => {
    renderModal({
      access: { universeName: 'Nerd', folder: { ...FOLDER, state: 'granted' }, file: FILE }
    });
    expect(screen.getByText('Allow nerd.redstring')).toBeTruthy();
    expect(screen.getByText('Allowed')).toBeTruthy();
  });

  it('says what is not being saved when the universe loaded anyway', () => {
    renderModal({
      loaded: true,
      access: { universeName: 'Nerd', folder: null, file: { ...FILE, isSourceOfTruth: false } }
    });
    expect(screen.getByText('Let Redstring back into your files')).toBeTruthy();
    expect(screen.getByText(/aren’t being saved to nerd\.redstring/)).toBeTruthy();
  });

  it('points Chrome at Allow on every visit, and only Chrome', () => {
    renderModal({ showChromeTip: true });
    expect(screen.getByText('Allow on every visit')).toBeTruthy();
    cleanup();
    renderModal({ showChromeTip: false });
    expect(screen.queryByText('Allow on every visit')).toBeNull();
    expect(screen.getByText('Your browser will ask you to confirm.')).toBeTruthy();
  });

  it('sends a blocked site to its settings instead of promising a prompt', () => {
    renderModal({
      showChromeTip: true,
      access: { universeName: 'Nerd', folder: { ...FOLDER, state: 'denied' }, file: FILE }
    });
    expect(screen.getByText('Blocked')).toBeTruthy();
    expect(screen.getByText(/blocking file access for this site/)).toBeTruthy();
    expect(screen.queryByText('Allow on every visit')).toBeNull();
  });

  it('offers the desktop app only when asked to', () => {
    const onDownloadDesktop = vi.fn();
    renderModal({ offerDesktop: true, onDownloadDesktop });
    fireEvent.click(screen.getByText('Get the desktop app').closest('button'));
    expect(onDownloadDesktop).toHaveBeenCalledTimes(1);
    cleanup();
    renderModal();
    expect(screen.queryByText('Get the desktop app')).toBeNull();
  });

  it('shows what went wrong when the grant throws', async () => {
    renderModal({ onGrant: async () => { throw new Error('File access permission was denied.'); } });
    await act(async () => {
      fireEvent.click(screen.getByText('Allow access').closest('button'));
    });
    expect(screen.getByText('File access permission was denied.')).toBeTruthy();
  });

  it('closes itself once everything is allowed and the universe is in', () => {
    vi.useFakeTimers();
    const onResolved = vi.fn();
    const allowed = { universeName: 'Nerd', folder: { ...FOLDER, state: 'granted' }, file: { ...FILE, state: 'granted' } };

    const { rerender } = renderModal({ access: allowed, loaded: false, onResolved });
    // Allowed but not loaded yet: the action becomes the load, and it waits.
    expect(screen.getByText('Load Nerd')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onResolved).not.toHaveBeenCalled();

    rerender(
      <FileAccessModal isVisible onClose={() => {}} access={allowed} loaded onGrant={async () => {}} onResolved={onResolved} />
    );
    act(() => { vi.advanceTimersByTime(700); });
    expect(onResolved).toHaveBeenCalledTimes(1);
  });
});

describe('ModalGallery', () => {
  it('opens every file access preview without touching the browser', () => {
    render(<ModalGallery />);
    const shows = screen.getAllByText('Show');
    expect(shows.length).toBe(5);

    shows.forEach((_, i) => {
      fireEvent.click(screen.getAllByText('Show')[i].closest('button'));
      // Every variant has a way out that the row then reports.
      fireEvent.click(screen.getByTitle('Close'));
      expect(screen.getAllByText('onClose').length).toBeGreaterThan(0);
    });
  });
});
