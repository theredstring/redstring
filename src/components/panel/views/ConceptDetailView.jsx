import React from 'react';
import { ArrowLeft, ExternalLink, Plus, Network, Info } from 'lucide-react';
import { getTextColor } from '../../../utils/colorUtils';
import DraggableConceptCard from '../items/DraggableConceptCard';

// Detail view for a focused semantic concept
// Shows rich metadata and a browseable list of relationships
const ConceptDetailView = ({
    concept,
    onBack,
    onNavigate,
    onMaterialize,
    onPreviewGraph,
    isLoading
}) => {
    if (!concept) return null;

    const headerColor = concept.color || '#8B0000';
    const textColor = getTextColor(headerColor);

    return (
        <div className="concept-detail-view" style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            background: '#fff',
            borderRadius: '8px',
            overflow: 'hidden'
        }}>
            {/* Header */}
            <div style={{
                padding: '12px',
                background: headerColor,
                color: textColor,
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                flexShrink: 0
            }}>
                <button
                    onClick={onBack}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        color: textColor
                    }}
                    title="Back"
                >
                    <ArrowLeft size={20} />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                        fontFamily: "'EmOne', sans-serif",
                        fontWeight: 'bold',
                        fontSize: '18px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                    }}>
                        {concept.name}
                    </div>
                    {concept.category && (
                        <div style={{
                            fontSize: '11px',
                            opacity: 0.8,
                            fontFamily: "'EmOne', sans-serif"
                        }}>
                            {concept.category}
                        </div>
                    )}
                </div>
            </div>

            {/* Scrollable Content */}
            <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>

                {/* Description */}
                <div style={{ marginBottom: '20px' }}>
                    <div style={{
                        fontSize: '14px',
                        lineHeight: '1.5',
                        color: '#333',
                        fontFamily: "'EmOne', sans-serif"
                    }}>
                        {concept.description}
                    </div>
                    <div style={{
                        marginTop: '8px',
                        display: 'flex',
                        gap: '12px',
                        fontSize: '11px',
                        color: '#666'
                    }}>
                        {concept.semanticMetadata?.externalLinks?.length > 0 && (
                            <a
                                href={concept.semanticMetadata.externalLinks[0]}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#666', textDecoration: 'none' }}
                            >
                                <ExternalLink size={10} />
                                {concept.source}
                            </a>
                        )}
                        {concept.semanticMetadata?.confidence && (
                            <span title="Confidence score">
                                ★ {Math.round(concept.semanticMetadata.confidence * 100)}%
                            </span>
                        )}
                    </div>
                </div>

                {/* Actions Bar */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
                    <button
                        onClick={() => onMaterialize(concept)}
                        style={{
                            flex: 1,
                            padding: '8px',
                            background: '#260000',
                            color: '#EFE8E5',
                            border: 'none',
                            borderRadius: '6px',
                            fontFamily: "'EmOne', sans-serif",
                            fontSize: '12px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px'
                        }}
                    >
                        <Plus size={14} />
                        Add to Graph
                    </button>
                    <button
                        onClick={() => onPreviewGraph && onPreviewGraph(concept)}
                        style={{
                            flex: 1,
                            padding: '8px',
                            background: '#f0e6e3',
                            color: '#260000',
                            border: '1px solid #260000',
                            borderRadius: '6px',
                            fontFamily: "'EmOne', sans-serif",
                            fontSize: '12px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px'
                        }}
                    >
                        <Network size={14} />
                        Preview Graph
                    </button>
                </div>

                {/* Relationships List */}
                <div>
                    <div style={{
                        fontSize: '12px',
                        fontWeight: 'bold',
                        color: '#260000',
                        marginBottom: '8px',
                        fontFamily: "'EmOne', sans-serif",
                        borderBottom: '1px solid #eee',
                        paddingBottom: '4px'
                    }}>
                        Relationships ({concept.relationships?.length || 0})
                    </div>

                    {isLoading ? (
                        <div style={{ padding: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                            <div className="spinner" style={{
                                width: '20px',
                                height: '20px',
                                border: '2px solid #f3f3f3',
                                borderTop: '2px solid #8B0000',
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite'
                            }} />
                            <style>{`
                                @keyframes spin {
                                    0% { transform: rotate(0deg); }
                                    100% { transform: rotate(360deg); }
                                }
                            `}</style>
                        </div>
                    ) : (!concept.relationships || concept.relationships.length === 0) ? (
                        <div style={{ fontSize: '12px', color: '#999', fontStyle: 'italic', padding: '8px' }}>
                            No specific relationships found.
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                            {concept.relationships.map((rel, idx) => {
                                // Determine direction and label
                                const isOutgoing = rel.source === concept.name;
                                const otherName = isOutgoing ? rel.target : rel.source;
                                const predicate = rel.predicate || rel.type || rel.relation || 'relatedTo';
                                // Clean predicate label
                                const label = predicate.split('/').pop().replace(/([A-Z])/g, ' $1').toLowerCase();

                                return (
                                    <div
                                        key={`${idx}-${otherName}`}
                                        onClick={() => onNavigate(otherName)}
                                        style={{
                                            padding: '10px 8px',
                                            borderBottom: '1px solid #f5f5f5',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            transition: 'background 0.2s'
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.background = '#f9f9f9'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                    >
                                        <div style={{ color: '#ccc' }}>
                                            {/* Left side arrow for incoming */}
                                            {!isOutgoing && <ArrowLeft size={14} />}
                                        </div>
                                        <div style={{
                                            fontSize: '11px',
                                            color: '#888',
                                            width: '80px',
                                            textAlign: isOutgoing ? 'left' : 'right',
                                            flexShrink: 0,
                                            fontFamily: "'EmOne', sans-serif"
                                        }}>
                                            {label}
                                        </div>
                                        <div style={{ color: '#ccc' }}>
                                            {/* Right side arrow for outgoing */}
                                            {isOutgoing && <Network size={14} style={{ transform: 'rotate(-90deg)' }} />}
                                            {/* Using Network icon temporarily as a "connects to" symbol to differentiate from back/forward navigation */}
                                        </div>
                                        <div style={{
                                            fontSize: '13px',
                                            color: '#260000',
                                            fontWeight: '500',
                                            flex: 1
                                        }}>
                                            {otherName}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
};

export default ConceptDetailView;
