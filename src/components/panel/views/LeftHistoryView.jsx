import React, { useState, useMemo } from 'react';
import useHistoryStore from '../../../store/historyStore.js';
import useGraphStore from '../../../store/graphStore.jsx';
import { generateDescription } from '../../../utils/actionDescriptions.js';
import { Clock, Globe, Filter, LayoutGrid } from 'lucide-react';
import './LeftHistoryView.css';

const LeftHistoryView = () => {
    const history = useHistoryStore(state => state.history);
    const currentIndex = useHistoryStore(state => state.currentIndex);
    const activeGraphId = useGraphStore(state => state.activeGraphId);
    const applyPatches = useGraphStore(state => state.applyPatches);
    const [filter, setFilter] = useState('all'); // 'all', 'graph', 'global'

    const effectiveIndex = history.length + currentIndex;

    const filteredHistory = useMemo(() => {
        // Tag with original index then reverse
        const withIndices = history.map((h, i) => ({ ...h, originalIndex: i }));
        const reversed = withIndices.reverse();

        if (filter === 'all') return reversed;
        if (filter === 'global') return reversed.filter(h => h.domain === 'global');
        if (filter === 'graph') {
            const targetDomain = `graph-${activeGraphId}`;
            return reversed.filter(h => h.domain === targetDomain);
        }
        return reversed;
    }, [history, filter, activeGraphId]);

    const handleJumpTo = (index) => {
        // Get jumpTo directly from store to ensure we have the latest function reference
        const jumpTo = useHistoryStore.getState().jumpTo;
        if (typeof jumpTo === 'function') {
            jumpTo(index, applyPatches);
        } else {
            console.error('[LeftHistoryView] jumpTo is not a function:', jumpTo);
        }
    };

    return (
        <div className="left-history-view">
            <div className="history-header">
                <h2>Action History</h2>
                <div className="history-stats">
                    {history.length} actions • {currentIndex === -1 ? 'Latest' : `${Math.abs(currentIndex) - 1} steps back`}
                </div>
            </div>

            {/* Filter tabs */}
            <div className="history-filter-tabs">
                <button
                    onClick={() => setFilter('all')}
                    className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
                    title="Show all history"
                >
                    <Filter size={14} />
                    <span>All</span>
                </button>
                <button
                    onClick={() => setFilter('graph')}
                    className={`filter-tab ${filter === 'graph' ? 'active' : ''}`}
                    disabled={!activeGraphId}
                    title="Show local history"
                >
                    <LayoutGrid size={14} />
                    <span>Graph</span>
                </button>
                <button
                    onClick={() => setFilter('global')}
                    className={`filter-tab ${filter === 'global' ? 'active' : ''}`}
                    title="Show global history"
                >
                    <Globe size={14} />
                    <span>Global</span>
                </button>
            </div>

            {/* History list */}
            <div className="history-list">
                {filteredHistory.length === 0 ? (
                    <div className="history-empty">
                        <Clock size={48} opacity={0.2} />
                        <p>No actions recorded yet</p>
                        {filter === 'graph' && !activeGraphId && <small>Select a graph to see local history</small>}
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
        </div>
    );
};

const HistoryItem = ({ entry, isActive, isHead, onClick }) => {
    const isGlobal = entry.domain === 'global';
    const timeAgo = formatTimeAgo(entry.timestamp);

    return (
        <div
            className={`history-item ${isGlobal ? 'global' : 'graph'} ${isActive ? 'active' : 'undone'} ${isHead ? 'head' : ''}`}
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
