import React, { useState } from 'react';
import './ToolCallCard.css';

const ToolCallCard = ({ toolName, status, args, result, error, timestamp, executionTime }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const getStatusIcon = () => {
        switch (status) {
            case 'running': return '⏳';
            case 'completed': return '✓';
            case 'failed': return '✗';
            default: return '○';
        }
    };

    const getStatusClass = () => {
        switch (status) {
            case 'running': return 'status-running';
            case 'completed': return 'status-completed';
            case 'failed': return 'status-failed';
            default: return '';
        }
    };

    const getStatusText = () => {
        switch (status) {
            case 'running': return 'Running...';
            case 'completed': return 'Completed';
            case 'failed': return 'Failed';
            default: return '';
        }
    };

    const getSummaryText = () => {
        if (error) return error;
        if (!result) return '';

        const parts = [];
        if (result.nodeCount > 0) parts.push(`${result.nodeCount} node${result.nodeCount !== 1 ? 's' : ''}`);
        if (result.edgeCount > 0) parts.push(`${result.edgeCount} connection${result.edgeCount !== 1 ? 's' : ''}`);

        let summary = parts.length > 0 ? `Added ${parts.join(', ')}` : '';
        if (result.graphName) summary += ` to "${result.graphName}"`;

        return summary;
    };

    const formatToolName = (name) => {
        return name
            .replace(/_/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
    };

    // Debug logging
    console.log('[ToolCallCard] Rendering:', { toolName, status, hasResult: !!result, result });

    return (
        <div className={`tool-call-card ${getStatusClass()}`}>
            <div
                className="tool-call-header"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="tool-icon">{getStatusIcon()}</div>
                <div className="tool-header-content">
                    <div className="tool-header-row">
                        <span className="tool-name">{formatToolName(toolName)}</span>
                        <span className="status-badge">{getStatusText()}</span>
                        <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>▾</span>
                    </div>
                    {getSummaryText() && (
                        <div className="tool-call-summary">{getSummaryText()}</div>
                    )}
                </div>
            </div>

            {isExpanded && (
                <div className="tool-call-details">
                    {result && result.nodesAdded && result.nodesAdded.length > 0 && (
                        <div className="detail-section">
                            <h4>Nodes Created</h4>
                            <ul className="node-list">
                                {result.nodesAdded.map((node, idx) => (
                                    <li key={idx}>{node}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {result && result.edgesAdded && result.edgesAdded.length > 0 && (
                        <div className="detail-section">
                            <h4>Connections</h4>
                            <ul className="edge-list">
                                {result.edgesAdded.slice(0, 10).map((edge, idx) => (
                                    <li key={idx}>
                                        <span>{edge.source}</span>
                                        <span className="edge-arrow">→</span>
                                        <span>{edge.target}</span>
                                        {edge.type && <span className="edge-type">({edge.type})</span>}
                                    </li>
                                ))}
                                {result.edgesAdded.length > 10 && (
                                    <li className="more-items">... and {result.edgesAdded.length - 10} more</li>
                                )}
                            </ul>
                        </div>
                    )}

                    {!result && !error && (
                        <div className="detail-section">
                            <p style={{ color: 'rgba(38, 0, 0, 0.6)', fontSize: '12px', fontStyle: 'italic' }}>
                                No detailed results available
                            </p>
                        </div>
                    )}

                    {executionTime && (
                        <div className="execution-time">
                            Completed in {executionTime.toFixed(2)}s
                        </div>
                    )}

                    {error && (
                        <div className="error-details">
                            <h4>Error</h4>
                            <div className="error-message">{error}</div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default ToolCallCard;
