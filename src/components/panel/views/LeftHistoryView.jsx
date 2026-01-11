import React, { useState, useMemo } from 'react';
import useHistoryStore from '../../../store/historyStore.js';
import useGraphStore from '../../../store/graphStore.jsx';
import { Clock, Globe, Filter, LayoutGrid } from 'lucide-react';
import './LeftHistoryView.css';

const LeftHistoryView = () => {
    const history = useHistoryStore(state => state.history);
    const activeGraphId = useGraphStore(state => state.activeGraphId);
    const [filter, setFilter] = useState('all'); // 'all', 'graph', 'global'

    const filteredHistory = useMemo(() => {
        // Reverse to show newest first
        const reversed = history.slice().reverse();

        if (filter === 'all') return reversed;
        if (filter === 'global') return reversed.filter(h => h.domain === 'global');
        if (filter === 'graph') {
            const targetDomain = `graph-${activeGraphId}`;
            return reversed.filter(h => h.domain === targetDomain);
        }
        return reversed;
    }, [history, filter, activeGraphId]);

    return (
        <div className="left-history-view">
            <div className="history-header">
                <h2>Action History</h2>
                <div className="history-stats">
                    {history.length} actions recorded
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
                    title="Show history for current graph"
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
                        <HistoryItem key={entry.id} entry={entry} />
                    ))
                )}
            </div>
        </div>
    );
};

const HistoryItem = ({ entry }) => {
    const isGlobal = entry.domain === 'global';
    const timeAgo = formatTimeAgo(entry.timestamp);

    return (
        <div className={`history-item ${isGlobal ? 'global' : 'graph'}`}>
            <div className="history-item-icon">
                {isGlobal ? <Globe size={14} /> : <LayoutGrid size={14} />}
            </div>
            <div className="history-item-content">
                <div className="history-item-description" title={entry.description}>
                    {entry.description}
                </div>
                <div className="history-item-meta">
                    <span className="history-time">{timeAgo}</span>
                    {/* <span className="history-type">{entry.actionType}</span> */}
                </div>
            </div>
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
