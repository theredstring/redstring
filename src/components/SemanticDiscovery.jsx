import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Globe, Search, Zap, Settings, Database, Link } from 'lucide-react';
import SemanticEditor from './SemanticEditor';
import ConnectionBrowser from './ConnectionBrowser';
import CollapsibleSection from './CollapsibleSection';
import './SemanticDiscovery.css';

/**
 * Consolidated Semantic Discovery Section
 * Progressive disclosure: Simple → Guided → Advanced
 * Preserves all existing functionality while providing clean organization
 */
const SemanticDiscovery = ({ 
  nodeData, 
  onNodeUpdate, 
  onMaterializeConnection,
  isUltraSlim = false 
}) => {
  const [activeTab, setActiveTab] = useState('links'); // 'links' | 'connections'

  if (!nodeData) {
    return (
      <div className="semantic-discovery-empty">
        No node data available for semantic discovery
      </div>
    );
  }

  return (
    <div className="semantic-discovery">
      {/* Clean Tab Navigation */}
      <div className="discovery-tabs">
        <button
          className={`discovery-tab ${activeTab === 'links' ? 'active' : ''}`}
          onClick={() => setActiveTab('links')}
        >
          Quick Links
        </button>
        <button
          className={`discovery-tab ${activeTab === 'connections' ? 'active' : ''}`}
          onClick={() => setActiveTab('connections')}
        >
          All Connections
        </button>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === 'links' && (
          <div className="links-tab">
            <SemanticEditor 
              nodeData={nodeData}
              onUpdate={onNodeUpdate}
            />
          </div>
        )}

        {activeTab === 'connections' && (
          <div className="connections-tab">
            <ConnectionBrowser 
              nodeData={nodeData}
              onMaterializeConnection={onMaterializeConnection}
            />
          </div>
        )}
      </div>
    </div>
  );
};


export default SemanticDiscovery;