import React, { useState, useEffect, useMemo } from 'react';
import { Globe, Database, Search, ExternalLink, Plus, Settings, RefreshCw, CheckCircle, X, Eye, EyeOff } from 'lucide-react';
import SemanticEditor from './SemanticEditor';
import { knowledgeFederation } from '../services/knowledgeFederation';

// Global search state manager for persistent search sessions
const searchStateManager = {
  states: new Map(),
  
  getState: (nodeId, searchType = 'search') => {
    const key = `${nodeId}-${searchType}`;
    return searchStateManager.states.get(key) || {
      query: '',
      isSearching: false,
      results: null,
      progress: null,
      sources: ['wikidata', 'dbpedia'],
      maxEntities: 10,
      maxDepth: 1,
      searchHistory: [],
      lastSearchTime: null
    };
  },
  
  setState: (nodeId, searchType, newState) => {
    const key = `${nodeId}-${searchType}`;
    const currentState = searchStateManager.getState(nodeId, searchType);
    searchStateManager.states.set(key, { ...currentState, ...newState });
  },
  
  clearState: (nodeId, searchType) => {
    const key = `${nodeId}-${searchType}`;
    searchStateManager.states.delete(key);
  },
  
  getAllStates: () => {
    return Array.from(searchStateManager.states.entries()).map(([key, state]) => {
      const [nodeId, searchType] = key.split('-');
      return { nodeId, searchType, state, key };
    });
  }
};
import './SemanticIdentity.css';

/**
 * Semantic Web Identity Component
 * Determines and displays how this node relates to the semantic web:
 * - Neutral: No semantic web integration
 * - Provider: Self-hosted semantic data (publishes RDF)
 * - Receiver: Consumes external semantic data (imports from Wikidata/DBpedia)
 */
const SemanticIdentity = ({ 
  nodeData, 
  onNodeUpdate, 
  onMaterializeConnection,
  isUltraSlim = false 
}) => {
  const [identity, setIdentity] = useState('neutral'); // 'neutral' | 'provider' | 'receiver'
  const [activeTab, setActiveTab] = useState('urls'); // 'urls' | 'search' | 'publish'

  // Determine semantic identity based on node data
  useEffect(() => {
    if (!nodeData) return;
    
    // Check if node has external semantic links (receiver)
    const hasExternalLinks = nodeData.equivalentClasses?.length > 0 || 
                            nodeData.externalLinks?.length > 0;
    
    // Check if node publishes semantic data (provider) 
    const hasSemanticPublishing = nodeData.rdfEndpoint || nodeData.semanticSchema;
    
    if (hasSemanticPublishing) {
      setIdentity('provider');
      setActiveTab('publish');
    } else if (hasExternalLinks) {
      setIdentity('receiver');
      setActiveTab('urls');
    } else {
      setIdentity('neutral');
      setActiveTab('urls');
    }
  }, [nodeData]);

  if (!nodeData) {
    return (
      <div className="semantic-identity-empty">
        No node data available
      </div>
    );
  }

  return (
    <div className="semantic-identity">
      {/* Identity Status Indicator */}
      <div className={`identity-indicator ${identity}`}>
        <div className="identity-icon">
          {identity === 'neutral' && <Globe size={16} />}
          {identity === 'provider' && <Database size={16} />}
          {identity === 'receiver' && <ExternalLink size={16} />}
        </div>
        <div className="identity-status">
          <span className="identity-label">
            {identity === 'neutral' && 'Not connected to semantic web'}
            {identity === 'provider' && 'Publishing semantic data'}
            {identity === 'receiver' && 'Connected to external sources'}
          </span>
          {identity !== 'neutral' && (
            <button 
              className="identity-reset"
              onClick={() => setIdentity('neutral')}
              title="Disconnect from semantic web"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Content based on identity */}
      {identity === 'neutral' && (
        <NeutralState 
          onBecomProvider={() => setIdentity('provider')}
          onBecomeReceiver={() => setIdentity('receiver')}
        />
      )}

      {identity === 'receiver' && (
        <ReceiverState 
          nodeData={nodeData}
          onNodeUpdate={onNodeUpdate}
          onMaterializeConnection={onMaterializeConnection}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
        />
      )}

      {identity === 'provider' && (
        <ProviderState 
          nodeData={nodeData}
          onNodeUpdate={onNodeUpdate}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
        />
      )}
    </div>
  );
};

/**
 * Neutral State - No semantic web integration
 */
const NeutralState = ({ onBecomeProvider, onBecomeReceiver }) => {
  return (
    <div className="neutral-state">
      <div className="integration-options">
        <div className="integration-option" onClick={onBecomeReceiver}>
          <div className="option-icon">
            <ExternalLink size={20} />
          </div>
          <div className="option-content">
            <h4>Connect to External Data</h4>
            <p>Link to Wikipedia, Wikidata, DBpedia and other sources</p>
          </div>
        </div>
        
        <div className="integration-option" onClick={onBecomeProvider}>
          <div className="option-icon">
            <Database size={20} />
          </div>
          <div className="option-content">
            <h4>Publish Semantic Data</h4>
            <p>Make this node's data available via RDF endpoints</p>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Receiver State - Consuming external semantic data
 */
const ReceiverState = ({ 
  nodeData, 
  onNodeUpdate, 
  onMaterializeConnection, 
  activeTab, 
  setActiveTab 
}) => {
  return (
    <div className="receiver-state">
      {/* Tab Navigation */}
      <div className="receiver-tabs">
        <button
          className={`receiver-tab ${activeTab === 'urls' ? 'active' : ''}`}
          onClick={() => setActiveTab('urls')}
        >
          Related URLs
        </button>
        <button
          className={`receiver-tab ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => setActiveTab('search')}
        >
          Federated Search
        </button>
        <button
          className={`receiver-tab ${activeTab === 'mass' ? 'active' : ''}`}
          onClick={() => setActiveTab('mass')}
        >
          Mass Import
        </button>
      </div>

      {/* Global Search Status */}
      <GlobalSearchStatus />
      
      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === 'urls' && (
          <div className="urls-tab">
            <SemanticEditor 
              nodeData={nodeData}
              onUpdate={onNodeUpdate}
            />
          </div>
        )}

        {activeTab === 'search' && (
          <div className="search-tab">
            <div className="search-description">
              <Search size={16} />
              <span>Search and import knowledge from federated sources</span>
            </div>
            
            {/* Functional Federated Search Interface */}
            <FederatedSearchInterface 
              seedEntity={nodeData.name}
              nodeId={nodeData.id}
              onMaterializeConnection={onMaterializeConnection}
            />
          </div>
        )}

        {activeTab === 'mass' && (
          <div className="mass-tab">
            <div className="mass-description">
              <Database size={16} />
              <span>Import large knowledge clusters and perform bulk operations</span>
            </div>
            
            {/* Mass Import Interface */}
            <MassImportInterface 
              seedEntity={nodeData.name}
              nodeId={nodeData.id}
              onMaterializeConnection={onMaterializeConnection}
            />
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Provider State - Publishing semantic data
 */
const ProviderState = ({ nodeData, onNodeUpdate, activeTab, setActiveTab }) => {
  return (
    <div className="provider-state">
      {/* Tab Navigation */}
      <div className="provider-tabs">
        <button
          className={`provider-tab ${activeTab === 'publish' ? 'active' : ''}`}
          onClick={() => setActiveTab('publish')}
        >
          Publishing
        </button>
        <button
          className={`provider-tab ${activeTab === 'schema' ? 'active' : ''}`}
          onClick={() => setActiveTab('schema')}
        >
          Schema
        </button>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === 'publish' && (
          <div className="publish-tab">
            <div className="publish-description">
              <Database size={16} />
              <span>Configure RDF endpoint and publishing options</span>
            </div>
            
            <div className="publishing-config">
              <div className="config-placeholder">
                <p>📡 RDF Publishing Configuration</p>
                <p>Set up SPARQL endpoint, configure access policies</p>
                <p>Manage vocabularies and ontology mappings</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'schema' && (
          <div className="schema-tab">
            <div className="schema-description">
              <Settings size={16} />
              <span>Define semantic schema and relationships</span>
            </div>
            
            <div className="schema-config">
              <div className="schema-placeholder">
                <p>🏗️ Semantic Schema Definition</p>
                <p>Define properties, relationships, and constraints</p>
                <p>Map to existing ontologies and vocabularies</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Global Search Status - Shows all active searches across nodes
 */
const GlobalSearchStatus = () => {
  const [allStates, setAllStates] = useState([]);
  const [isVisible, setIsVisible] = useState(false);
  
  // Refresh all states periodically
  useEffect(() => {
    const refreshStates = () => {
      const states = searchStateManager.getAllStates().filter(({ state }) => 
        state.isSearching || state.searchHistory?.some(h => h.status === 'running')
      );
      setAllStates(states);
      setIsVisible(states.length > 0);
    };
    
    refreshStates();
    const interval = setInterval(refreshStates, 1000);
    return () => clearInterval(interval);
  }, []);
  
  if (!isVisible) return null;
  
  return (
    <div className="global-search-status">
      <div className="global-status-header">
        <div className="status-indicator">
          <RefreshCw size={12} className="spin" />
          <span>Active Searches ({allStates.length})</span>
        </div>
        <button 
          onClick={() => setIsVisible(false)} 
          className="minimize-button"
          title="Minimize"
        >
          <EyeOff size={12} />
        </button>
      </div>
      <div className="global-status-list">
        {allStates.map(({ nodeId, searchType, state, key }) => {
          const runningSearches = state.searchHistory?.filter(h => h.status === 'running') || [];
          return (
            <div key={key} className="global-status-item">
              <span className="node-name">Node {nodeId.slice(-8)}</span>
              <span className="search-type">{searchType}</span>
              {runningSearches.length > 0 && (
                <span className="running-count">{runningSearches.length} running</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Mass Import Interface for bulk operations with persistent state
 */
const MassImportInterface = ({ seedEntity, nodeId, onMaterializeConnection }) => {
  // Use persistent state from search state manager
  const massImportState = useMemo(() => searchStateManager.getState(nodeId, 'mass'), [nodeId]);
  const [importPresets, setImportPresets] = useState([
    { id: 'quick', name: 'Quick Import', description: 'Small focused import for immediate use', sources: ['wikidata'], depth: 1, entities: 5 },
    { id: 'academic', name: 'Academic Profile', description: 'Import academic papers, citations, collaborators', sources: ['wikidata'], depth: 2, entities: 25 },
    { id: 'company', name: 'Company Profile', description: 'Import subsidiaries, competitors, key personnel', sources: ['wikidata', 'dbpedia'], depth: 2, entities: 50 },
    { id: 'person', name: 'Person Profile', description: 'Import relationships, works, affiliations', sources: ['wikidata', 'dbpedia'], depth: 2, entities: 35 },
    { id: 'concept', name: 'Concept Map', description: 'Import related concepts, definitions, examples', sources: ['wikidata', 'dbpedia'], depth: 3, entities: 100 }
  ]);
  const [selectedPreset, setSelectedPreset] = useState(massImportState.selectedPreset || null);
  const [isImporting, setIsImporting] = useState(massImportState.isImporting || false);
  const [importProgress, setImportProgress] = useState(massImportState.progress || null);
  const [importResults, setImportResults] = useState(massImportState.results || null);
  const [importHistory, setImportHistory] = useState(massImportState.importHistory || []);
  
  // Persist state changes
  useEffect(() => {
    searchStateManager.setState(nodeId, 'mass', {
      selectedPreset,
      isImporting,
      progress: importProgress,
      results: importResults,
      importHistory
    });
  }, [nodeId, selectedPreset, isImporting, importProgress, importResults, importHistory]);

  const handlePresetImport = async (preset) => {
    setSelectedPreset(preset);
    setIsImporting(true);
    setImportProgress(null);
    setImportResults(null);

    try {
      const results = await knowledgeFederation.importKnowledgeCluster(seedEntity, {
        maxDepth: preset.depth,
        maxEntitiesPerLevel: preset.entities,
        includeRelationships: true,
        includeSources: preset.sources,
        onProgress: (progress) => {
          setImportProgress(progress);
        }
      });

      setImportResults(results);
      
      // Auto-import all relationships
      if (results.relationships) {
        results.relationships.forEach(rel => {
          if (onMaterializeConnection) {
            onMaterializeConnection({
              subject: rel.source,
              predicate: rel.relation,
              object: rel.target,
              confidence: rel.confidence,
              source: 'mass-import'
            });
          }
        });
      }

      console.log(`[MassImport] Imported ${results.relationships?.length || 0} relationships for ${preset.name}`);
    } catch (error) {
      console.error('[MassImport] Failed:', error);
      setImportResults({ error: error.message });
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  return (
    <div className="mass-import">
      <div className="import-presets">
        <h4>Import Presets</h4>
        <div className="preset-grid">
          {importPresets.map(preset => (
            <div key={preset.id} className="preset-card">
              <div className="preset-header">
                <h5>{preset.name}</h5>
                <div className="preset-stats">
                  <span>~{preset.entities} entities</span>
                  <span>{preset.depth} levels deep</span>
                </div>
              </div>
              <p className="preset-description">{preset.description}</p>
              <div className="preset-sources">
                {preset.sources.map(source => (
                  <span key={source} className="source-tag">{source}</span>
                ))}
              </div>
              <button
                onClick={() => handlePresetImport(preset)}
                disabled={isImporting}
                className="preset-button"
              >
                {isImporting && selectedPreset?.id === preset.id ? (
                  <>
                    <RefreshCw size={14} className="spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Database size={14} />
                    Import {preset.name}
                  </>
                )}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Progress Display */}
      {importProgress && (
        <div className="import-progress">
          <RefreshCw size={14} className="spin" />
          <span>Processing {importProgress.entity} (level {importProgress.level})...</span>
          <div className="progress-stage">{importProgress.stage}</div>
        </div>
      )}

      {/* Results Summary */}
      {importResults && (
        <div className="import-results">
          {importResults.error ? (
            <div className="import-error">
              <span>Import failed: {importResults.error}</span>
            </div>
          ) : (
            <div className="import-success">
              <CheckCircle size={16} />
              <div className="success-details">
                <span>Successfully imported {importResults.relationships?.length || 0} relationships</span>
                <span>from {importResults.entities?.size || 0} entities</span>
                <span>All relationships have been added to your current graph</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Functional Federated Search Interface with persistent state
 */
const FederatedSearchInterface = ({ seedEntity, onMaterializeConnection, nodeId }) => {
  // Use persistent state from search state manager
  const nodeSearchState = useMemo(() => searchStateManager.getState(nodeId, 'search'), [nodeId]);
  
  const [searchQuery, setSearchQuery] = useState(nodeSearchState.query || seedEntity || '');
  const [isSearching, setIsSearching] = useState(nodeSearchState.isSearching);
  const [searchResults, setSearchResults] = useState(nodeSearchState.results);
  const [importProgress, setImportProgress] = useState(nodeSearchState.progress);
  const [selectedSources, setSelectedSources] = useState(nodeSearchState.sources);
  const [maxEntities, setMaxEntities] = useState(nodeSearchState.maxEntities);
  const [maxDepth, setMaxDepth] = useState(nodeSearchState.maxDepth);
  const [searchHistory, setSearchHistory] = useState(nodeSearchState.searchHistory);

  const sources = [
    { id: 'wikidata', name: 'Wikidata', description: 'Structured knowledge base' },
    { id: 'dbpedia', name: 'DBpedia', description: 'Structured Wikipedia content' },
    { id: 'conceptnet', name: 'ConceptNet', description: 'Common sense knowledge' }
  ];

  // Persist state changes
  useEffect(() => {
    searchStateManager.setState(nodeId, 'search', {
      query: searchQuery,
      isSearching,
      results: searchResults,
      progress: importProgress,
      sources: selectedSources,
      maxEntities,
      maxDepth,
      searchHistory
    });
  }, [nodeId, searchQuery, isSearching, searchResults, importProgress, selectedSources, maxEntities, maxDepth, searchHistory]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    const searchId = `search-${nodeId}-${Date.now()}`;
    setIsSearching(true);
    setImportProgress({ stage: 'initializing', searchId });
    
    // Add to search history
    const newHistoryItem = {
      id: searchId,
      query: searchQuery,
      timestamp: new Date(),
      status: 'running',
      sources: [...selectedSources],
      maxEntities,
      maxDepth
    };
    setSearchHistory(prev => [newHistoryItem, ...prev].slice(0, 10)); // Keep last 10 searches
    
    try {
      const results = await knowledgeFederation.importKnowledgeCluster(searchQuery, {
        maxDepth,
        maxEntitiesPerLevel: maxEntities,
        includeRelationships: true,
        includeSources: selectedSources,
        onProgress: (progress) => {
          setImportProgress(progress);
        }
      });
      
      setSearchResults(results);
      
      // Update search history
      setSearchHistory(prev => prev.map(item => 
        item.id === searchId 
          ? { ...item, status: 'completed', results, entityCount: results.entities?.size || 0, relationshipCount: results.relationships?.length || 0 }
          : item
      ));
      
      console.log('[FederatedSearch] Import results:', results);
    } catch (error) {
      console.error('[FederatedSearch] Import failed:', error);
      setSearchResults({ error: error.message });
      
      // Update search history with error
      setSearchHistory(prev => prev.map(item => 
        item.id === searchId 
          ? { ...item, status: 'failed', error: error.message }
          : item
      ));
    } finally {
      setIsSearching(false);
      setImportProgress(null);
    }
  };

  const handleMaterializeRelationship = (relationship) => {
    if (onMaterializeConnection) {
      onMaterializeConnection({
        subject: relationship.source,
        predicate: relationship.relation,
        object: relationship.target,
        confidence: relationship.confidence,
        source: relationship.sourceType || 'federated'
      });
    }
  };

  const handleMassImport = () => {
    if (searchResults?.relationships) {
      // Import all relationships at once
      searchResults.relationships.forEach(rel => {
        handleMaterializeRelationship(rel);
      });
      
      // Update search history to mark as imported
      setSearchHistory(prev => prev.map(item => 
        item.status === 'completed' && item.results === searchResults
          ? { ...item, imported: true, importedAt: new Date() }
          : item
      ));
    }
  };
  
  const handleRerunSearch = (historyItem) => {
    setSearchQuery(historyItem.query);
    setSelectedSources(historyItem.sources);
    setMaxEntities(historyItem.maxEntities);
    setMaxDepth(historyItem.maxDepth);
    setTimeout(() => handleSearch(), 100);
  };
  
  const handleClearHistory = () => {
    setSearchHistory([]);
  };

  return (
    <div className="federated-search">
      {/* Search Configuration */}
      <div className="search-config">
        <div className="search-input-group">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Enter entity name to search..."
            className="search-input"
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button
            onClick={handleSearch}
            disabled={isSearching || !searchQuery.trim()}
            className="search-button"
          >
            {isSearching ? <RefreshCw size={16} className="spin" /> : <Search size={16} />}
          </button>
        </div>
        
        {/* Advanced Options */}
        <div className="search-options">
          <div className="option-group">
            <label>Sources:</label>
            <div className="source-checkboxes">
              {sources.map(source => (
                <label key={source.id} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedSources.includes(source.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedSources(prev => [...prev, source.id]);
                      } else {
                        setSelectedSources(prev => prev.filter(id => id !== source.id));
                      }
                    }}
                  />
                  <span>{source.name}</span>
                </label>
              ))}
            </div>
          </div>
          
          <div className="option-group">
            <label>Max Entities: {maxEntities}</label>
            <input
              type="range"
              min="5"
              max="50"
              value={maxEntities}
              onChange={(e) => setMaxEntities(parseInt(e.target.value))}
              className="range-slider"
            />
          </div>
          
          <div className="option-group">
            <label>Search Depth: {maxDepth}</label>
            <input
              type="range"
              min="1"
              max="3"
              value={maxDepth}
              onChange={(e) => setMaxDepth(parseInt(e.target.value))}
              className="range-slider"
            />
          </div>
        </div>
      </div>

      {/* Progress Indicator */}
      {importProgress && (
        <div className="import-progress">
          <RefreshCw size={14} className="spin" />
          <span>Importing {importProgress.entity} (level {importProgress.level})...</span>
        </div>
      )}

      {/* Search History */}
      {searchHistory.length > 0 && (
        <div className="search-history">
          <div className="history-header">
            <h4>Search History ({searchHistory.length})</h4>
            <button onClick={handleClearHistory} className="clear-history-button" title="Clear history">
              <X size={14} />
            </button>
          </div>
          <div className="history-list">
            {searchHistory.slice(0, 5).map((item) => (
              <div key={item.id} className={`history-item ${item.status}`}>
                <div className="history-item-header">
                  <span className="history-query">{item.query}</span>
                  <div className="history-actions">
                    {item.status === 'completed' && (
                      <button 
                        onClick={() => handleRerunSearch(item)}
                        className="rerun-button"
                        title="Rerun this search"
                      >
                        <RefreshCw size={12} />
                      </button>
                    )}
                    {item.status === 'running' && <RefreshCw size={12} className="spin" />}
                    {item.status === 'failed' && <span className="error-indicator">✗</span>}
                    {item.status === 'completed' && <CheckCircle size={12} className="success-indicator" />}
                  </div>
                </div>
                <div className="history-item-details">
                  <span className="history-timestamp">{item.timestamp.toLocaleTimeString()}</span>
                  {item.status === 'completed' && (
                    <span className="history-results">
                      {item.entityCount} entities, {item.relationshipCount} relationships
                      {item.imported && <span className="imported-badge">imported</span>}
                    </span>
                  )}
                  {item.status === 'failed' && (
                    <span className="history-error">{item.error}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Search Results */}
      {searchResults && (
        <div className="search-results">
          {searchResults.error ? (
            <div className="search-error">
              <span>Error: {searchResults.error}</span>
            </div>
          ) : (
            <>
              <div className="results-summary">
                <div className="summary-stats">
                  <span>{searchResults.totalEntities || searchResults.entities?.size || 0} entities</span>
                  <span>{searchResults.relationships?.length || 0} relationships</span>
                </div>
                {searchResults.relationships?.length > 0 && (
                  <button
                    onClick={handleMassImport}
                    className="mass-import-button"
                    title="Import all relationships to current graph"
                  >
                    <Plus size={14} />
                    Import All ({searchResults.relationships.length})
                  </button>
                )}
              </div>
              
              {/* Relationships List */}
              {searchResults.relationships?.length > 0 && (
                <div className="relationships-list">
                  <h4>Knowledge Relationships</h4>
                  {searchResults.relationships.slice(0, 20).map((rel, index) => (
                    <div key={index} className="relationship-item">
                      <div className="relationship-triplet">
                        <span className="subject">{rel.source}</span>
                        <span className="predicate">{rel.relation}</span>
                        <span className="object">{rel.target}</span>
                      </div>
                      <div className="relationship-actions">
                        <span className="confidence">({Math.round((rel.confidence || 0.5) * 100)}%)</span>
                        <button
                          onClick={() => handleMaterializeRelationship(rel)}
                          className="materialize-button"
                          title="Add to current graph"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {searchResults.relationships.length > 20 && (
                    <div className="more-results">
                      +{searchResults.relationships.length - 20} more relationships
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SemanticIdentity;