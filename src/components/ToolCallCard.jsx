import React, { useState } from 'react';
import './ToolCallCard.css';

const ToolCallCard = ({ toolName, status, args, result, error, timestamp, executionTime }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    // Ensure args is an object
    let parsedArgs = {};
    if (typeof args === 'string') {
        try {
            parsedArgs = JSON.parse(args);
        } catch (e) {
            console.warn('[ToolCallCard] Failed to parse args:', args);
        }
    } else if (args && typeof args === 'object') {
        parsedArgs = args;
    }

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

        if (toolName === 'searchNodes') {
            const count = result.results ? result.results.length : 0;
            const query = parsedArgs?.query ? ` for "${parsedArgs.query}"` : '';
            return `Found ${count} matching node(s)${query}`;
        }
        if (toolName === 'getNodeContext') {
            const count = result.neighbors ? result.neighbors.length : 0;
            const node = parsedArgs?.nodeId ? ` for "${parsedArgs.nodeId}"` : '';
            return `Retrieved node with ${count} neighbor(s)${node}`;
        }
        if (toolName === 'listGroups') {
            const count = result.count || (result.groups ? result.groups.length : 0);
            return `Found ${count} group(s)`;
        }
        if (toolName === 'updateGroup') {
            const added = parsedArgs?.addMembers ? parsedArgs.addMembers.length : 0;
            const removed = parsedArgs?.removeMembers ? parsedArgs.removeMembers.length : 0;
            const groupName = parsedArgs?.groupName || 'a group';

            if (added > 0 && removed > 0) return `Added ${added} and removed ${removed} from ${groupName}`;
            if (added > 0) return `Added ${added} to ${groupName}`;
            if (removed > 0) return `Removed ${removed} from ${groupName}`;
            return `Updated ${groupName}`;
        }
        if (toolName === 'expandGraph' || toolName === 'createPopulatedGraph') {
            const nodeCount = result.nodesAdded || 0;
            const edgeCount = result.edgesAdded || 0;
            if (nodeCount > 0 && edgeCount > 0) return `Added ${nodeCount} node(s) and ${edgeCount} connection(s)`;
            if (nodeCount > 0) return `Added ${nodeCount} node(s)`;
            if (edgeCount > 0) return `Added ${edgeCount} connection(s)`;
            return 'Expanded graph';
        }

        const parts = [];
        const nodeCount = result.nodeCount || (Array.isArray(result.nodesAdded) ? result.nodesAdded.length : 0);
        const edgeCount = result.edgeCount || (Array.isArray(result.edgesAdded) ? result.edgesAdded.length : 0);
        const groupCount = result.groupCount || (Array.isArray(result.groupsAdded) ? result.groupsAdded.length : 0);

        if (nodeCount > 0) parts.push(`${nodeCount} node${nodeCount !== 1 ? 's' : ''}`);
        if (edgeCount > 0) parts.push(`${edgeCount} connection${edgeCount !== 1 ? 's' : ''}`);
        if (groupCount > 0) parts.push(`${groupCount} group${groupCount !== 1 ? 's' : ''}`);

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

                    {result && typeof result.edgesAdded === 'number' && result.edgesAdded > 0 && (
                        <div className="detail-section">
                            <h4>Graph Expanded</h4>
                            <p>Added {result.nodesAdded} nodes and {result.edgesAdded} connections. Check the main canvas to see the new entities!</p>
                        </div>
                    )}

                    {result && Array.isArray(result.groupsAdded) && result.groupsAdded.length > 0 && (
                        <div className="detail-section">
                            <h4>Groups</h4>
                            <ul className="group-list">
                                {result.groupsAdded.map((group, idx) => (
                                    <li key={idx}>{typeof group === 'string' ? group : group.name}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {parsedArgs && parsedArgs.addMembers && parsedArgs.addMembers.length > 0 && (
                        <div className="detail-section">
                            <h4>Added to Group</h4>
                            <ul className="node-list">
                                {parsedArgs.addMembers.map((member, idx) => (
                                    <li key={idx}>{member}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {parsedArgs && parsedArgs.removeMembers && parsedArgs.removeMembers.length > 0 && (
                        <div className="detail-section">
                            <h4>Removed from Group</h4>
                            <ul className="node-list">
                                {parsedArgs.removeMembers.map((member, idx) => (
                                    <li key={idx}>{member}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {result && result.results && result.results.length > 0 && (
                        <div className="detail-section">
                            <h4>Matching Nodes</h4>
                            <ul className="node-list">
                                {result.results.map((r, idx) => (
                                    <li key={idx}>
                                        <strong>{r.name}</strong>
                                        {r.description ? ` - ${r.description}` : ''}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {result && result.neighbors && result.neighbors.length > 0 && (
                        <div className="detail-section">
                            <h4>Neighbors</h4>
                            <ul className="node-list">
                                {result.neighbors.map((r, idx) => (
                                    <li key={idx}>
                                        <strong>{r.name}</strong>
                                        {r.relationship ? ` (${r.relationship})` : ''}
                                    </li>
                                ))}
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
