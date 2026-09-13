import React, { useState, useMemo, useEffect, useRef } from 'react';
import useHistoryStore from '../../../store/historyStore.js';
import useGraphStore from '../../../store/graphStore.js';
import { performJumpTo } from '../../../store/historyActions.js';
import { generateDescription } from '../../../utils/actionDescriptions.js';
import { Clock, Globe, Filter, LayoutGrid, GitBranch } from 'lucide-react';
import GitHistoryList from './GitHistoryList.jsx';
import './LeftHistoryView.css';

/**
 * Below this the tabs keep their icons and drop their words. Three labelled
 * tabs stop fitting before the panel reaches its own minimum width, and a
 * squeezed label is worse than none.
 */
const SLIM_TABS_WIDTH = 260;

const LeftHistoryView = ({ gitRequest = null }) => {
    const history = useHistoryStore(state => state.history);
    const currentIndex = useHistoryStore(state => state.currentIndex);
    const activeGraphId = useGraphStore(state => state.activeGraphId);
    // 'all' and 'graph' are undo steps from this session; 'git' is the
    // universe's committed history, which outlives the session entirely.
    const [filter, setFilter] = useState('all');
    // Set when arriving from a specific universe's repository row, so the Git
    // tab shows THAT universe rather than whichever one happens to be active.
    const [gitUniverseSlug, setGitUniverseSlug] = useState(null);
    const [isSlim, setIsSlim] = useState(false);
    const rootRef = useRef(null);

    useEffect(() => {
        const el = rootRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(([entry]) => {
            setIsSlim(entry.contentRect.width < SLIM_TABS_WIDTH);
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    /*
     * Arriving from a repository row in Universes. Panel holds the request and
     * passes it down, because this view is mounted by the same click and would
     * miss a window event it listened for itself. `at` changes on every click,
     * so asking twice for the same universe still re-selects the tab.
     */
    useEffect(() => {
        if (!gitRequest) return;
        setGitUniverseSlug(gitRequest.universeSlug || null);
        setFilter('git');
    }, [gitRequest?.at]); // eslint-disable-line react-hooks/exhaustive-deps

    const effectiveIndex = history.length + currentIndex;

    const filteredHistory = useMemo(() => {
        // Tag with original index then reverse
        const withIndices = history.map((h, i) => ({ ...h, originalIndex: i }));
        const reversed = withIndices.reverse();

        if (filter === 'all') return reversed;
        if (filter === 'graph') {
            const targetDomain = `graph-${activeGraphId}`;
            return reversed.filter(h => h.domain === targetDomain);
        }
        return reversed;
    }, [history, filter, activeGraphId]);

    // performJumpTo also closes any in-progress coalesced edit and brings the
    // target entry's graph into view before rewinding to it.
    const handleJumpTo = (index) => performJumpTo(index);

    const isGit = filter === 'git';

    return (
        <div className={`left-history-view ${isSlim ? 'slim' : ''}`} ref={rootRef}>
            <div className="history-header">
                <h2>{isGit ? 'Versions' : 'Action History'}</h2>
                {!isGit && (
                    <div className="history-stats">
                        {history.length} actions • {currentIndex === -1 ? 'Latest' : `${Math.abs(currentIndex) - 1} steps back`}
                    </div>
                )}
            </div>

            {/* Filter tabs */}
            <div className="history-filter-tabs">
                <button
                    onClick={() => setFilter('all')}
                    className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
                    data-nav="tab"
                    title="Show all history"
                >
                    <Filter size={14} />
                    <span>All</span>
                </button>
                <button
                    onClick={() => setFilter('graph')}
                    className={`filter-tab ${filter === 'graph' ? 'active' : ''}`}
                    data-nav="tab"
                    disabled={!activeGraphId}
                    title="Show this Web's history"
                >
                    <LayoutGrid size={14} />
                    <span>Web</span>
                </button>
                <button
                    onClick={() => { setGitUniverseSlug(null); setFilter('git'); }}
                    className={`filter-tab ${isGit ? 'active' : ''}`}
                    data-nav="tab"
                    title="Show versions saved to the repository"
                >
                    <GitBranch size={14} />
                    <span>Git</span>
                </button>
            </div>

            {isGit ? (
                <GitHistoryList universeSlug={gitUniverseSlug} isSlim={isSlim} />
            ) : (
                <div className="history-list">
                    {filteredHistory.length === 0 ? (
                        <div className="history-empty">
                            <Clock size={48} opacity={0.2} />
                            <p>No actions recorded yet</p>
                            {filter === 'graph' && !activeGraphId && <small>Open a Web to see its history</small>}
                        </div>
                    ) : (
                        filteredHistory.map(entry => (
                            <HistoryItem
                                key={entry.id}
                                entry={entry}
                                isActive={entry.originalIndex <= effectiveIndex}
                                isHead={entry.originalIndex === effectiveIndex}
                                onClick={() => handleJumpTo(entry.originalIndex)}
                            />
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

const HistoryItem = ({ entry, isActive, isHead, onClick }) => {
    const isGlobal = entry.domain === 'global';
    const timeAgo = formatTimeAgo(entry.timestamp);

    return (
        <div
            className={`history-item ${isGlobal ? 'global' : 'graph'} ${isActive ? 'active' : 'undone'} ${isHead ? 'head' : ''}`}
            data-nav="item"
            onClick={onClick}
            title={isActive ? "Restore state to this point" : "Redo to this point"}
        >
            <div className="history-item-icon">
                {isGlobal ? <Globe size={14} /> : <LayoutGrid size={14} />}
            </div>
            <div className="history-item-content">
                <div className="history-item-description">
                    {entry.description}
                </div>
                <div className="history-item-meta">
                    <span className="history-time">{timeAgo}</span>
                </div>
            </div>
            {/* Visual indicator for current state head */}
            {isHead && <div className="history-head-indicator" title="Current State"></div>}
        </div>
    );
};

// Helper for relative time
const formatTimeAgo = (timestamp) => {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);

    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(timestamp).toLocaleDateString();
};

export default LeftHistoryView;
