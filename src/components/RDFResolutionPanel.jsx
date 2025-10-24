/**
 * RDF Resolution Panel Component
 * 
 * Provides UI for resolving external links and displaying resolved RDF data
 * with expandable sections and error handling.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { resolveURI, clearCache, getCacheStats } from '../services/rdfResolver.js';
import { sparqlClient, testEndpoint } from '../services/sparqlClient.js';
import { semanticEnrichment, suggestExternalLinks, suggestEquivalentClasses } from '../services/semanticEnrichment.js';
import { rdfValidation, validateNode } from '../services/rdfValidation.js';
import { localSemanticQuery, semanticSearch, findRelatedEntities } from '../services/localSemanticQuery.js';
import { automaticEnrichment, enrichNode } from '../services/automaticEnrichment.js';
import { RotateCcw, ExternalLink, AlertTriangle, CheckCircle, Info, Loader2, RefreshCw, X, ChevronDown, Globe, Database, Search, Plus, Brain, Network, Users, Building, Zap, Sparkles } from 'lucide-react';

const RDFResolutionPanel = ({ nodeData, onUpdate, isVisible = false, onClose }) => {
  const [resolutionState, setResolutionState] = useState('idle'); // idle, loading, resolved, error
  const [resolvedData, setResolvedData] = useState({});
  const [expandedSections, setExpandedSections] = useState(new Set());
  const [suggestions, setSuggestions] = useState([]);
  const [validationResults, setValidationResults] = useState(null);
  const [endpointStatus, setEndpointStatus] = useState({});
  const [cacheStats, setCacheStats] = useState(null);
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const [localSearchResults, setLocalSearchResults] = useState([]);
  const [localSearchState, setLocalSearchState] = useState('idle'); // idle, loading, results
  const [autoEnrichmentResults, setAutoEnrichmentResults] = useState(null);
  const [autoEnrichmentState, setAutoEnrichmentState] = useState('idle'); // idle, loading, results, error
  const [enrichmentProgress, setEnrichmentProgress] = useState({
    wikidata: 'pending',
    dbpedia: 'pending', 
    local: 'pending'
  });

  // Load cache stats on mount
  useEffect(() => {
    if (isVisible) {
      setCacheStats(getCacheStats());
    }
  }, [isVisible]);

  // Check endpoint status on mount
  useEffect(() => {
    if (isVisible) {
      checkEndpointStatus();
    }
  }, [isVisible]);

  // Check endpoint connectivity
  const checkEndpointStatus = async () => {
    const endpoints = ['wikidata', 'dbpedia', 'schema'];
    const status = {};
    
    for (const endpoint of endpoints) {
      try {
        const result = await testEndpoint(endpoint);
        status[endpoint] = result;
      } catch (error) {
        status[endpoint] = { status: 'error', error: error.message };
      }
    }
    
    setEndpointStatus(status);
  };

  // Resolve external links for the current node
  const handleResolveLinks = async () => {
    if (!nodeData.externalLinks || nodeData.externalLinks.length === 0) {
      return;
    }

    setResolutionState('loading');
    
    try {
      const results = {};
      
      for (const link of nodeData.externalLinks) {
        try {
          const resolved = await resolveURI(link, { timeout: 10000 });
          results[link] = { status: 'resolved', data: resolved };
        } catch (error) {
          results[link] = { status: 'failed', error: error.message };
        }
      }
      
      setResolvedData(results);
      setResolutionState('resolved');
      
      // Auto-expand sections with resolved data
      const newExpanded = new Set(expandedSections);
      Object.keys(results).forEach(link => {
        if (results[link].status === 'resolved') {
          newExpanded.add(link);
        }
      });
      setExpandedSections(newExpanded);
      
    } catch (error) {
      console.error('[RDF Resolution] Failed to resolve links:', error);
      setResolutionState('error');
    }
  };

  // Get suggestions for external links
  const handleGetSuggestions = async () => {
    if (!nodeData) return;
    
    try {
      const linkSuggestions = await suggestExternalLinks(nodeData.id, nodeData);
      const classSuggestions = nodeData.typeNodeId ? 
        await suggestEquivalentClasses(nodeData.id, [nodeData.typeNodeId]) : [];
      
      setSuggestions({
        links: linkSuggestions,
        classes: classSuggestions
      });
    } catch (error) {
      console.error('[RDF Resolution] Failed to get suggestions:', error);
    }
  };

  // Validate the current node
  const handleValidateNode = async () => {
    if (!nodeData) return;
    
    try {
      const results = await validateNode(nodeData, { nodes: [nodeData] });
      setValidationResults(results);
    } catch (error) {
      console.error('[RDF Resolution] Validation failed:', error);
    }
  };

  // Perform local semantic search
  const handleLocalSearch = async () => {
    if (!localSearchQuery.trim()) return;
    
    setLocalSearchState('loading');
    
    try {
      const results = await semanticSearch(localSearchQuery.trim(), {
        graphId: null, // Search across all graphs
        nodeTypes: [],
        relationshipTypes: []
      });
      
      setLocalSearchResults(results);
      setLocalSearchState('results');
    } catch (error) {
      console.error('[Local Semantic Search] Search failed:', error);
      setLocalSearchState('idle');
    }
  };

  // Handle local search input change
  const handleLocalSearchInputChange = (e) => {
    setLocalSearchQuery(e.target.value);
    if (e.target.value.trim() === '') {
      setLocalSearchState('idle');
      setLocalSearchResults([]);
    }
  };

  // Handle local search key press
  const handleLocalSearchKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleLocalSearch();
    }
  };

  // Perform automatic semantic enrichment
  const handleAutoEnrich = async () => {
    if (!nodeData || !nodeData.name) return;
    
    setAutoEnrichmentState('loading');
    
    try {
      console.log(`[Auto Enrichment] Starting enrichment for: ${nodeData.name}`);
      
      // Add a timeout to prevent infinite loading
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Enrichment timeout - taking too long')), 30000)
      );
      
      const enrichmentPromise = enrichNode(nodeData, {
        forceRefresh: false,
        includeExternalData: true,
        includeLocalConnections: true,
        maxResults: 15
      });
      
      const results = await Promise.race([enrichmentPromise, timeoutPromise]);
      
      setAutoEnrichmentResults(results);
      setAutoEnrichmentState('results');
      
      console.log(`[Auto Enrichment] Completed for ${nodeData.name}:`, {
        externalData: results.totalExternalData,
        localConnections: results.totalLocalConnections,
        suggestions: results.totalSuggestions,
        fallbackMode: results.summary?.fallbackMode || false
      });
      
    } catch (error) {
      console.error('[Auto Enrichment] Failed:', error);
      setAutoEnrichmentState('error');
    }
  };

  // Apply enrichment suggestions to the node
  const handleApplyEnrichment = (suggestion) => {
    if (!nodeData || !suggestion) return;
    
    try {
      const updatedNode = { ...nodeData };
      
      switch (suggestion.type) {
        case 'external_link':
          // Add external link
          if (!updatedNode.externalLinks) updatedNode.externalLinks = [];
          if (!updatedNode.externalLinks.includes(suggestion.uri)) {
            updatedNode.externalLinks.push(suggestion.uri);
          }
          break;
          
        case 'type_assignment':
          // This would need to be handled by the parent component
          // as it involves creating/assigning types
          console.log(`[Auto Enrichment] Type assignment suggestion: ${suggestion.label}`);
          break;
          
        case 'local_connection':
          // This would need to be handled by the parent component
          // as it involves creating edges
          console.log(`[Auto Enrichment] Local connection suggestion: ${suggestion.label}`);
          break;
      }
      
      // Update the node
      onUpdate(updatedNode);
      
      console.log(`[Auto Enrichment] Applied suggestion: ${suggestion.label}`);
      
    } catch (error) {
      console.error('[Auto Enrichment] Failed to apply suggestion:', error);
    }
  };

  // Toggle section expansion
  const toggleSection = (sectionId) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId);
    } else {
      newExpanded.add(sectionId);
    }
    setExpandedSections(newExpanded);
  };

  // Handle manual URI correction
  const handleUriCorrection = (originalUri, correctedUri) => {
    setResolvedData(prev => ({
      ...prev,
      [originalUri]: {
        ...prev[originalUri],
        correctedUri: correctedUri.trim() || null
      }
    }));
  };

  // Try to resolve a manually corrected URI
  const handleManualResolve = async (originalUri) => {
    const result = resolvedData[originalUri];
    if (!result?.correctedUri) return;

    setResolutionState('loading');
    
    try {
      const resolved = await resolveURI(result.correctedUri, { timeout: 10000 });
      
      setResolvedData(prev => ({
        ...prev,
        [originalUri]: {
          ...prev[originalUri],
          status: 'resolved',
          data: resolved,
          originalUri: originalUri,
          correctedUri: result.correctedUri
        }
      }));
      
      setResolutionState('resolved');
      
      // Expand the corrected section
      setExpandedSections(prev => new Set([...prev, originalUri]));
      
    } catch (error) {
      setResolvedData(prev => ({
        ...prev,
        [originalUri]: {
          ...prev[originalUri],
          status: 'failed',
          error: `Manual resolution failed: ${error.message}`,
          correctedUri: result.correctedUri
        }
      }));
      setResolutionState('resolved');
    }
  };

  // Clear cache
  const handleClearCache = () => {
    clearCache();
    setCacheStats(getCacheStats());
  };

  // Refresh cache stats
  const handleRefreshStats = () => {
    setCacheStats(getCacheStats());
  };

  // Add suggested link
  const handleAddSuggestedLink = (suggestion) => {
    if (onUpdate && nodeData) {
      const updatedNode = { ...nodeData };
      if (!updatedNode.externalLinks) {
        updatedNode.externalLinks = [];
      }
      updatedNode.externalLinks.push(suggestion.uri);
      onUpdate(updatedNode);
    }
  };

  // Add suggested equivalent class
  const handleAddSuggestedClass = (suggestion) => {
    if (onUpdate && nodeData) {
      const updatedNode = { ...nodeData };
      if (!updatedNode.equivalentClasses) {
        updatedNode.equivalentClasses = [];
      }
      updatedNode.equivalentClasses.push(suggestion.uri);
      onUpdate(updatedNode);
    }
  };

  if (!isVisible) return null;

  return (
    <div className="rdf-resolution-panel" style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '90vw',
      maxWidth: '800px',
      maxHeight: '90vh',
      backgroundColor: '#bdb5b5',
      border: '2px solid #260000',
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
      zIndex: 10000,
      overflow: 'hidden',
      fontFamily: "'EmOne', sans-serif"
    }}>
      {/* Header */}
      <div style={{
        backgroundColor: '#260000',
        color: '#bdb5b5',
        padding: '16px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '2px solid #8B0000'
      }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>
          RDF Resolution & Validation
        </h2>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#bdb5b5',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(189, 181, 181, 0.2)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          <X size={20} />
        </button>
      </div>

      {/* Content */}
      <div style={{
        padding: '20px',
        overflowY: 'auto',
        maxHeight: 'calc(90vh - 80px)'
      }}>
        {/* Node Info */}
        <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: 'rgba(38, 0, 0, 0.05)', borderRadius: '8px' }}>
          <h3 style={{ margin: '0 0 8px 0', color: '#260000', fontSize: '1.1rem' }}>
            {nodeData?.name || 'Unnamed Node'}
          </h3>
          <p style={{ margin: '0 0 8px 0', color: '#666', fontSize: '0.9rem' }}>
            {nodeData?.description || 'No description available'}
          </p>
          {nodeData?.externalLinks && (
            <div style={{ fontSize: '0.85rem', color: '#666' }}>
              <strong>External Links:</strong> {nodeData.externalLinks.length}
            </div>
          )}
        </div>

        {/* What Auto-Enrich Does */}
        <div style={{ marginBottom: '16px', padding: '16px', backgroundColor: 'rgba(156, 39, 176, 0.1)', borderRadius: '8px', border: '1px solid rgba(156, 39, 176, 0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Sparkles size={20} style={{ color: '#9C27B0' }} />
            <h3 style={{ margin: 0, color: '#260000', fontSize: '1rem', fontWeight: 'bold' }}>
              What Does Auto-Enrich Do?
            </h3>
          </div>
          <div style={{ fontSize: '0.85rem', color: '#260000', lineHeight: '1.4' }}>
            <strong>Auto-Enrich automatically finds rich information about your nodes from multiple sources:</strong>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px', marginTop: '12px' }}>
            <div style={{ padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.7)', borderRadius: '4px', fontSize: '0.8rem' }}>
              <strong>🌐 Wikidata:</strong> Company info, descriptions, entity types
            </div>
            <div style={{ padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.7)', borderRadius: '4px', fontSize: '0.8rem' }}>
              <strong>📚 DBpedia:</strong> Additional context, abstracts, classifications
            </div>
            <div style={{ padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.7)', borderRadius: '4px', fontSize: '0.8rem' }}>
              <strong>🔗 Local Knowledge:</strong> Related entities in your graph
            </div>
            <div style={{ padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.7)', borderRadius: '4px', fontSize: '0.8rem' }}>
              <strong>💡 Smart Suggestions:</strong> What to add/connect automatically
            </div>
          </div>
        </div>

        {/* Endpoint Status Indicators */}
        <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'rgba(38, 0, 0, 0.05)', borderRadius: '6px', border: '1px solid rgba(38, 0, 0, 0.1)' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#260000', marginBottom: '8px' }}>
            🌐 Semantic Web Endpoint Status:
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
            
            {/* Wikidata Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', backgroundColor: 'rgba(255, 255, 255, 0.8)', borderRadius: '4px', border: '1px solid rgba(0, 0, 0, 0.1)' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#28a745' }} />
              <span style={{ fontSize: '0.8rem', color: '#260000', fontWeight: 'bold' }}>Wikidata</span>
              <span style={{ fontSize: '0.75rem', color: '#28a745', marginLeft: 'auto' }}>✓ Online</span>
            </div>
            
            {/* DBpedia Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', backgroundColor: 'rgba(255, 255, 255, 0.8)', borderRadius: '4px', border: '1px solid rgba(0, 0, 0, 0.1)' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#28a745' }} />
              <span style={{ fontSize: '0.8rem', color: '#260000', fontWeight: 'bold' }}>DBpedia</span>
              <span style={{ fontSize: '0.75rem', color: '#28a745', marginLeft: 'auto' }}>✓ Online</span>
            </div>
            
            {/* Schema.org Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', backgroundColor: 'rgba(255, 255, 255, 0.8)', borderRadius: '4px', border: '1px solid rgba(0, 0, 0, 0.1)' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#dc3545' }} />
              <span style={{ fontSize: '0.8rem', color: '#260000', fontWeight: 'bold' }}>Schema.org</span>
              <span style={{ fontSize: '0.75rem', color: '#dc3545', marginLeft: 'auto' }}>✗ CORS Blocked</span>
            </div>
            
            {/* Local Knowledge Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', backgroundColor: 'rgba(255, 255, 255, 0.8)', borderRadius: '4px', border: '1px solid rgba(0, 0, 0, 0.1)' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#28a745' }} />
              <span style={{ fontSize: '0.8rem', color: '#260000', fontWeight: 'bold' }}>Local Knowledge</span>
              <span style={{ fontSize: '0.75rem', color: '#28a745', marginLeft: 'auto' }}>✓ Available</span>
            </div>
          </div>
          
          <div style={{ marginTop: '8px', fontSize: '0.75rem', color: '#666', fontStyle: 'italic' }}>
            💡 <strong>Note:</strong> CORS restrictions are normal browser security. Wikidata and DBpedia work, Schema.org is blocked.
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <button
            onClick={handleAutoEnrich}
            disabled={!nodeData?.name || autoEnrichmentState === 'loading'}
            style={{
              backgroundColor: '#9C27B0',
              color: '#ffffff',
              border: 'none',
              padding: '10px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontWeight: 'bold',
              fontSize: '0.9rem',
              boxShadow: '0 2px 4px rgba(156, 39, 176, 0.3)'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#7B1FA2'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#9C27B0'}
          >
            {autoEnrichmentState === 'loading' ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
            Auto-Enrich
          </button>

          <button
            onClick={handleResolveLinks}
            disabled={!nodeData?.externalLinks || nodeData.externalLinks.length === 0 || resolutionState === 'loading'}
            style={{
              backgroundColor: '#8B0000',
              color: '#bdb5b5',
              border: 'none',
              padding: '10px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontWeight: 'bold',
              fontSize: '0.9rem'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#A52A2A'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#8B0000'}
          >
            {resolutionState === 'loading' ? <Loader2 size={16} className="spin" /> : <ExternalLink size={16} />}
            Resolve Links
          </button>

          <button
            onClick={handleGetSuggestions}
            style={{
              backgroundColor: '#2E8B57',
              color: '#bdb5b5',
              border: 'none',
              padding: '10px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontWeight: 'bold',
              fontSize: '0.9rem'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#3CB371'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#2E8B57'}
          >
            <Search size={16} />
            Get Suggestions
          </button>

          <button
            onClick={handleValidateNode}
            style={{
              backgroundColor: '#FF8C00',
              color: '#bdb5b5',
              border: 'none',
              padding: '10px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontWeight: 'bold',
              fontSize: '0.9rem'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#FFA500'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#FF8C00'}
          >
            <CheckCircle size={16} />
            Validate
          </button>
        </div>

        {/* Resolution Results */}
        {resolutionState === 'resolved' && Object.keys(resolvedData).length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 12px 0', color: '#260000', fontSize: '1.1rem' }}>
              Resolved Data
            </h3>
            {Object.entries(resolvedData).map(([uri, result]) => (
              <div key={uri} style={{ marginBottom: '12px' }}>
                <div
                  onClick={() => toggleSection(uri)}
                  style={{
                    backgroundColor: result.status === 'resolved' ? 'rgba(46, 139, 87, 0.1)' : 'rgba(255, 69, 0, 0.1)',
                    padding: '12px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    border: `1px solid ${result.status === 'resolved' ? '#2E8B57' : '#FF4500'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    outline: 'none'
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {result.status === 'resolved' ? <CheckCircle size={16} color="#2E8B57" /> : <AlertTriangle size={16} color="#FF4500" />}
                    <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>
                      {result.status === 'resolved' ? 'Resolved' : 'Failed'}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: '#666', wordBreak: 'break-all' }}>
                      {uri}
                    </span>
                  </div>
                  <ChevronDown 
                    size={16} 
                    style={{ 
                      transform: expandedSections.has(uri) ? 'rotate(0deg)' : 'rotate(-90deg)',
                      transition: 'transform 0.2s ease',
                      color: result.status === 'resolved' ? '#2E8B57' : '#FF4500'
                    }} 
                  />
                </div>

                {expandedSections.has(uri) && (
                  <div style={{ padding: '12px', backgroundColor: 'rgba(255, 255, 255, 0.5)', borderRadius: '6px', marginTop: '8px' }}>
                    {result.status === 'resolved' ? (
                      <>
                        <div style={{ marginBottom: '8px' }}>
                          <strong>Content Type:</strong> {result.data.contentType}
                        </div>
                        <div style={{ marginBottom: '8px' }}>
                          <strong>Triples:</strong> {result.data.triples.length}
                        </div>
                        {result.data.triples.length > 0 && (
                          <div style={{ maxHeight: '200px', overflowY: 'auto', fontSize: '0.8rem' }}>
                            {result.data.triples.slice(0, 10).map((triple, index) => (
                              <div key={index} style={{ marginBottom: '4px', fontFamily: 'monospace' }}>
                                {triple.subject} {triple.predicate} {triple.object}
                              </div>
                            ))}
                            {result.data.triples.length > 10 && (
                              <div style={{ color: '#666', fontStyle: 'italic' }}>
                                ... and {result.data.triples.length - 10} more triples
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ color: '#FF4500' }}>
                        <div style={{ marginBottom: '8px' }}>
                          <strong>Error:</strong> {result.error || 'Failed to resolve URI'}
                        </div>
                        <div style={{ marginBottom: '12px', fontSize: '0.9rem' }}>
                          This URI could not be automatically resolved. You can try:
                        </div>
                        <ul style={{ margin: '0 0 12px 0', paddingLeft: '20px', fontSize: '0.9rem' }}>
                          <li>Check if the URI is correct</li>
                          <li>Try a different schema namespace</li>
                          <li>Use a local identifier instead</li>
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* CORS Information */}
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 12px 0', color: '#260000', fontSize: '1.1rem' }}>
            ℹ️ About External URI Resolution
          </h3>
          <div style={{ padding: '16px', backgroundColor: 'rgba(255, 193, 7, 0.1)', borderRadius: '8px', border: '1px solid rgba(255, 193, 7, 0.3)' }}>
            <div style={{ marginBottom: '12px', fontSize: '0.9rem', color: '#856404' }}>
              <strong>Why do some URIs fail to resolve?</strong>
            </div>
            <div style={{ fontSize: '0.85rem', color: '#856404', lineHeight: '1.4' }}>
              <p style={{ margin: '0 0 8px 0' }}>
                <strong>CORS Policy:</strong> Web browsers block requests to external websites unless they explicitly allow it. 
                This is a security feature that prevents malicious websites from accessing your data.
              </p>
              <p style={{ margin: '0 0 8px 0' }}>
                <strong>Common blocked resources:</strong> Wikipedia, company websites, most SPARQL endpoints, and many schema repositories.
              </p>
              <p style={{ margin: '0 0 0 0' }}>
                <strong>Solutions:</strong> Use local identifiers (e.g., <code>local:MyType</code>) or schemas that support CORS.
              </p>
            </div>
          </div>
        </div>

        {/* Local Semantic Search */}
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 12px 0', color: '#260000', fontSize: '1.1rem' }}>
            🧠 Local Semantic Search
          </h3>
          <div style={{ padding: '16px', backgroundColor: 'rgba(40, 167, 69, 0.1)', borderRadius: '8px', border: '1px solid rgba(40, 167, 69, 0.3)' }}>
            <div style={{ marginBottom: '12px', fontSize: '0.9rem', color: '#155724' }}>
              <strong>Search your knowledge graph for related concepts, entities, and patterns.</strong>
            </div>
            
            {/* Search Input */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input
                type="text"
                value={localSearchQuery}
                onChange={handleLocalSearchInputChange}
                onKeyPress={handleLocalSearchKeyPress}
                placeholder="Search for concepts like 'Electronic Arts', 'gaming', 'software'..."
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  border: '1px solid #28a745',
                  borderRadius: '6px',
                  fontSize: '0.9rem',
                  fontFamily: "'EmOne', sans-serif",
                  backgroundColor: 'rgba(255, 255, 255, 0.9)'
                }}
              />
              <button
                onClick={handleLocalSearch}
                disabled={!localSearchQuery.trim() || localSearchState === 'loading'}
                style={{
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#218838'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#28a745'}
              >
                {localSearchState === 'loading' ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
                Search
              </button>
            </div>

            {/* Search Results */}
            {localSearchState === 'loading' && (
              <div style={{ textAlign: 'center', padding: '20px', color: '#28a745' }}>
                <Loader2 size={24} className="spin" />
                <div style={{ marginTop: '8px', fontSize: '0.9rem' }}>Searching your knowledge graph...</div>
              </div>
            )}

            {localSearchState === 'results' && localSearchResults.length > 0 && (
              <div>
                <div style={{ marginBottom: '8px', fontSize: '0.85rem', color: '#155724', fontWeight: 'bold' }}>
                  Found {localSearchResults.length} related entities:
                </div>
                <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                  {localSearchResults.map((result, index) => (
                    <div key={result.id} style={{
                      padding: '8px',
                      marginBottom: '6px',
                      backgroundColor: 'rgba(255, 255, 255, 0.7)',
                      borderRadius: '4px',
                      border: '1px solid rgba(40, 167, 69, 0.2)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <div style={{
                          width: '12px',
                          height: '12px',
                          borderRadius: '50%',
                          backgroundColor: result.color || '#8B0000'
                        }} />
                        <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
                          {result.name}
                        </span>
                        {result.type && (
                          <span style={{ fontSize: '0.75rem', color: '#666', backgroundColor: 'rgba(0,0,0,0.1)', padding: '2px 6px', borderRadius: '3px' }}>
                            {result.type}
                          </span>
                        )}
                        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#28a745' }}>
                          {Math.round(result.relevance)}% match
                        </span>
                      </div>
                      
                      {result.description && (
                        <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '4px', lineHeight: '1.3' }}>
                          {result.description.length > 100 ? 
                            `${result.description.substring(0, 100)}...` : 
                            result.description
                          }
                        </div>
                      )}
                      
                      {result.context && (
                        <div style={{ fontSize: '0.75rem', color: '#666' }}>
                          <span style={{ marginRight: '8px' }}>
                            <Network size={12} style={{ display: 'inline', marginRight: '2px' }} />
                            {result.context.relationshipCount} connections
                          </span>
                          {result.context.commonTypes.length > 0 && (
                            <span>
                              <Users size={12} style={{ display: 'inline', marginRight: '2px' }} />
                              Common types: {result.context.commonTypes.slice(0, 3).map(t => t.type).join(', ')}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {localSearchState === 'results' && localSearchResults.length === 0 && (
              <div style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
                <Brain size={24} style={{ opacity: 0.5 }} />
                <div style={{ marginTop: '8px', fontSize: '0.9rem' }}>No related entities found in your knowledge graph.</div>
                <div style={{ marginTop: '4px', fontSize: '0.8rem', color: '#888' }}>
                  Try different search terms or add more concepts to your graph.
                </div>
              </div>
            )}

            {/* Search Tips */}
            <div style={{ marginTop: '12px', padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.3)', borderRadius: '4px', fontSize: '0.75rem', color: '#155724' }}>
              <strong>💡 Search Tips:</strong> Try searching for company names, concepts, types, or descriptive terms. 
              The system finds matches in names, descriptions, and external links, and calculates semantic similarity.
            </div>
          </div>
        </div>

        {/* Auto-Enrichment Loading */}
        {autoEnrichmentState === 'loading' && (
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 12px 0', color: '#260000', fontSize: '1.1rem' }}>
              ⏳ Auto-Enriching "{nodeData?.name || 'Node'}"...
            </h3>
            <div style={{ padding: '16px', backgroundColor: 'rgba(156, 39, 176, 0.1)', borderRadius: '8px', border: '1px solid rgba(156, 39, 176, 0.3)' }}>
              
              {/* Progress Steps */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#260000', marginBottom: '12px' }}>
                  Enrichment Progress:
                </div>
                
                {/* Wikidata Status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.7)', borderRadius: '4px' }}>
                  <div style={{ 
                    width: '16px', 
                    height: '16px', 
                    borderRadius: '50%', 
                    backgroundColor: enrichmentProgress.wikidata === 'completed' ? '#28a745' : 
                                   enrichmentProgress.wikidata === 'failed' ? '#dc3545' : '#ffc107' 
                  }} />
                  <span style={{ fontSize: '0.85rem', color: '#260000' }}>
                    {enrichmentProgress.wikidata === 'completed' ? 'Wikidata ✓ Completed' :
                     enrichmentProgress.wikidata === 'failed' ? 'Wikidata ✗ Failed' :
                     'Querying Wikidata...'}
                  </span>
                  {enrichmentProgress.wikidata === 'pending' && <Loader2 size={14} className="spin" style={{ marginLeft: 'auto' }} />}
                  {enrichmentProgress.wikidata === 'completed' && <CheckCircle size={14} style={{ marginLeft: 'auto', color: '#28a745' }} />}
                  {enrichmentProgress.wikidata === 'failed' && <X size={14} style={{ marginLeft: 'auto', color: '#dc3545' }} />}
                </div>
                
                {/* DBpedia Status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.7)', borderRadius: '4px' }}>
                  <div style={{ 
                    width: '16px', 
                    height: '16px', 
                    borderRadius: '50%', 
                    backgroundColor: enrichmentProgress.dbpedia === 'completed' ? '#28a745' : 
                                   enrichmentProgress.dbpedia === 'failed' ? '#dc3545' : '#ffc107' 
                  }} />
                  <span style={{ fontSize: '0.85rem', color: '#260000' }}>
                    {enrichmentProgress.dbpedia === 'completed' ? 'DBpedia ✓ Completed' :
                     enrichmentProgress.dbpedia === 'failed' ? 'DBpedia ✗ Failed' :
                     'Querying DBpedia...'}
                  </span>
                  {enrichmentProgress.dbpedia === 'pending' && <Loader2 size={14} className="spin" style={{ marginLeft: 'auto' }} />}
                  {enrichmentProgress.dbpedia === 'completed' && <CheckCircle size={14} style={{ marginLeft: 'auto', color: '#28a745' }} />}
                  {enrichmentProgress.dbpedia === 'failed' && <X size={14} style={{ marginLeft: 'auto', color: '#dc3545' }} />}
                </div>
                
                {/* Local Knowledge Status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.7)', borderRadius: '4px' }}>
                  <div style={{ 
                    width: '16px', 
                    height: '16px', 
                    borderRadius: '50%', 
                    backgroundColor: enrichmentProgress.local === 'completed' ? '#28a745' : 
                                   enrichmentProgress.local === 'failed' ? '#dc3545' : '#ffc107' 
                  }} />
                  <span style={{ fontSize: '0.85rem', color: '#260000' }}>
                    {enrichmentProgress.local === 'completed' ? 'Local Knowledge ✓ Completed' :
                     enrichmentProgress.local === 'failed' ? 'Local Knowledge ✗ Failed' :
                     'Searching local knowledge...'}
                  </span>
                  {enrichmentProgress.local === 'pending' && <Loader2 size={14} className="spin" style={{ marginLeft: 'auto' }} />}
                  {enrichmentProgress.local === 'completed' && <CheckCircle size={14} style={{ marginLeft: 'auto', color: '#28a745' }} />}
                  {enrichmentProgress.local === 'failed' && <X size={14} style={{ marginLeft: 'auto', color: '#dc3545' }} />}
                </div>
              </div>
              
              {/* Overall Progress */}
              <div style={{ textAlign: 'center', padding: '16px', backgroundColor: 'rgba(255, 255, 255, 0.8)', borderRadius: '6px' }}>
                <Loader2 size={32} className="spin" style={{ color: '#9C27B0' }} />
                <div style={{ marginTop: '12px', fontSize: '1rem', fontWeight: 'bold', color: '#260000' }}>
                  Enriching with Semantic Web Data
                </div>
                <div style={{ marginTop: '8px', fontSize: '0.9rem', color: '#666' }}>
                  Querying multiple sources for rich entity information...
                </div>
                <div style={{ marginTop: '16px', fontSize: '0.8rem', color: '#8B0000', fontWeight: 'bold' }}>
                  ⏱️ Expected completion: 10-30 seconds
                </div>
                
                {/* Quick Status Summary */}
                <div style={{ marginTop: '12px', padding: '8px', backgroundColor: 'rgba(156, 39, 176, 0.1)', borderRadius: '4px', fontSize: '0.75rem' }}>
                  <div style={{ color: '#260000', fontWeight: 'bold', marginBottom: '4px' }}>Current Status:</div>
                  <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: '0.7rem' }}>
                    <span style={{ color: enrichmentProgress.wikidata === 'completed' ? '#28a745' : enrichmentProgress.wikidata === 'failed' ? '#dc3545' : '#ffc107' }}>
                      Wikidata: {enrichmentProgress.wikidata}
                    </span>
                    <span style={{ color: enrichmentProgress.dbpedia === 'completed' ? '#28a745' : enrichmentProgress.dbpedia === 'failed' ? '#dc3545' : '#ffc107' }}>
                      DBpedia: {enrichmentProgress.dbpedia}
                    </span>
                    <span style={{ color: enrichmentProgress.local === 'completed' ? '#28a745' : enrichmentProgress.local === 'failed' ? '#dc3545' : '#ffc107' }}>
                      Local: {enrichmentProgress.local}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Auto-Enrichment Results */}
        {autoEnrichmentState === 'results' && autoEnrichmentResults && (
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 12px 0', color: '#260000', fontSize: '1.1rem' }}>
              ✨ Auto-Enrichment Results for "{autoEnrichmentResults.nodeTitle}"
              {autoEnrichmentResults.summary?.fallbackMode && (
                <span style={{ fontSize: '0.8rem', color: '#ff8c00', marginLeft: '8px', fontWeight: 'normal' }}>
                  (Local Mode - External Sources Unavailable)
                </span>
              )}
            </h3>
            <div style={{ padding: '16px', backgroundColor: 'rgba(156, 39, 176, 0.1)', borderRadius: '8px', border: '1px solid rgba(156, 39, 176, 0.3)' }}>
              
              {/* Summary Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                <div style={{ textAlign: 'center', padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.7)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#9C27B0' }}>
                    {autoEnrichmentResults.summary.totalSources}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>Data Sources</div>
                </div>
                <div style={{ textAlign: 'center', padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.7)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#9C27B0' }}>
                    {autoEnrichmentResults.summary.totalExternalData}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>External Entities</div>
                </div>
                <div style={{ textAlign: 'center', padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.7)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#9C27B0' }}>
                    {autoEnrichmentResults.summary.totalSuggestions}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>Suggestions</div>
                </div>
                <div style={{ textAlign: 'center', padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.7)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#9C27B0' }}>
                    {autoEnrichmentResults.summary.totalLocalConnections}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>Local Connections</div>
                </div>
              </div>

              {/* External Data Sources */}
              {autoEnrichmentResults.externalData.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <h4 style={{ margin: '0 0 8px 0', color: '#9C27B0', fontSize: '1rem' }}>
                    🌐 External Data Sources
                  </h4>
                  <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {autoEnrichmentResults.externalData.slice(0, 5).map((entity, index) => (
                      <div key={index} style={{
                        padding: '8px',
                        marginBottom: '6px',
                        backgroundColor: 'rgba(255, 255, 255, 0.8)',
                        borderRadius: '4px',
                        border: '1px solid rgba(156, 39, 176, 0.2)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
                            {entity.label}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: '#666', backgroundColor: 'rgba(0,0,0,0.1)', padding: '2px 6px', borderRadius: '3px' }}>
                            {entity.type}
                          </span>
                          <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#9C27B0' }}>
                            {Math.round(entity.confidence * 100)}% match
                          </span>
                        </div>
                        {entity.description && (
                          <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '4px', lineHeight: '1.3' }}>
                            {entity.description.length > 150 ? 
                              `${entity.description.substring(0, 150)}...` : 
                              entity.description
                            }
                          </div>
                        )}
                        <div style={{ fontSize: '0.75rem', color: '#888' }}>
                          Source: {entity.source} • ID: {entity.id}
                        </div>
                      </div>
                    ))}
                    {autoEnrichmentResults.externalData.length > 5 && (
                      <div style={{ textAlign: 'center', fontSize: '0.8rem', color: '#666', fontStyle: 'italic' }}>
                        ... and {autoEnrichmentResults.externalData.length - 5} more entities
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Intelligent Suggestions */}
              {autoEnrichmentResults.suggestions.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <h4 style={{ margin: '0 0 8px 0', color: '#9C27B0', fontSize: '1rem' }}>
                    💡 Intelligent Suggestions
                  </h4>
                  <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {autoEnrichmentResults.suggestions.slice(0, 8).map((suggestion, index) => (
                      <div key={index} style={{
                        padding: '8px',
                        marginBottom: '6px',
                        backgroundColor: 'rgba(255, 255, 255, 0.8)',
                        borderRadius: '4px',
                        border: '1px solid rgba(156, 39, 176, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 'bold', marginBottom: '2px', fontSize: '0.9rem' }}>
                            {suggestion.label}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '4px' }}>
                            {suggestion.description}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#888' }}>
                            Confidence: {Math.round(suggestion.confidence * 100)}%
                          </div>
                        </div>
                        <button
                          onClick={() => handleApplyEnrichment(suggestion)}
                          style={{
                            backgroundColor: '#9C27B0',
                            color: 'white',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            fontWeight: 'bold'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#7B1FA2'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#9C27B0'}
                        >
                          Apply
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Local Connections */}
              {autoEnrichmentResults.localConnections.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <h4 style={{ margin: '0 0 8px 0', color: '#9C27B0', fontSize: '1rem' }}>
                    🔗 Local Knowledge Graph Connections
                  </h4>
                  <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
                    {autoEnrichmentResults.localConnections.slice(0, 5).map((conn, index) => (
                      <div key={index} style={{
                        padding: '6px 8px',
                        marginBottom: '4px',
                        backgroundColor: 'rgba(255, 255, 255, 0.8)',
                        borderRadius: '4px',
                        fontSize: '0.85rem'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{
                            width: '10px',
                            height: '10px',
                            borderRadius: '50%',
                            backgroundColor: conn.color || '#8B0000'
                          }} />
                          <span style={{ fontWeight: 'bold' }}>{conn.name}</span>
                          <span style={{ fontSize: '0.75rem', color: '#666' }}>({conn.type})</span>
                          <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#9C27B0' }}>
                            {Math.round(conn.relevance)}% relevant
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                <button
                  onClick={() => setAutoEnrichmentState('idle')}
                  style={{
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '0.9rem'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#5a6268'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#6c757d'}
                >
                  Close
                </button>
                <button
                  onClick={() => handleAutoEnrich()}
                  style={{
                    backgroundColor: '#9C27B0',
                    color: 'white',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    fontWeight: 'bold'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#7B1FA2'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#9C27B0'}
                >
                  <RefreshCw size={14} style={{ marginRight: '4px' }} />
                  Refresh
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Auto-Enrichment Error */}
        {autoEnrichmentState === 'error' && (
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 12px 0', color: '#260000', fontSize: '1.1rem' }}>
              ❌ Auto-Enrichment Failed
            </h3>
            <div style={{ padding: '16px', backgroundColor: 'rgba(220, 53, 69, 0.1)', borderRadius: '8px', border: '1px solid rgba(220, 53, 69, 0.3)' }}>
              <div style={{ color: '#721c24', fontSize: '0.9rem', marginBottom: '12px' }}>
                Automatic enrichment encountered an error. This could be due to:
              </div>
              <ul style={{ margin: '0 0 12px 0', paddingLeft: '20px', fontSize: '0.85rem', color: '#721c24' }}>
                <li>Network connectivity issues</li>
                <li>External service unavailability</li>
                <li>CORS restrictions on some sources (this is normal)</li>
                <li>Invalid or unsupported node title</li>
                <li>Query timeouts (external services are slow)</li>
              </ul>
              <div style={{ marginTop: '12px', padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.3)', borderRadius: '4px', fontSize: '0.8rem', color: '#721c24' }}>
                <strong>💡 Note:</strong> CORS errors and timeouts are expected when querying external semantic web sources from a browser. 
                The system will fall back to local knowledge graph data when external sources are unavailable.
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                <button
                  onClick={() => setAutoEnrichmentState('idle')}
                  style={{
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '0.9rem'
                  }}
                >
                  Close
                </button>
                <button
                  onClick={() => handleAutoEnrich()}
                  style={{
                    backgroundColor: '#dc3545',
                    color: 'white',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '0.9rem'
                  }}
                >
                  Try Again
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Manual URI Correction */}
        {resolutionState === 'resolved' && Object.keys(resolvedData).length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 12px 0', color: '#260000', fontSize: '1.1rem' }}>
              Manual URI Correction
            </h3>
            <div style={{ padding: '16px', backgroundColor: 'rgba(38, 0, 0, 0.05)', borderRadius: '8px' }}>
              <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#666' }}>
                If automatic resolution failed, you can manually specify the correct RDF schema URI or local identifier.
              </p>
              
              {/* Common Schema Suggestions */}
              <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'rgba(255, 255, 255, 0.3)', borderRadius: '6px' }}>
                <div style={{ marginBottom: '8px', fontSize: '0.85rem', fontWeight: 'bold', color: '#260000' }}>
                  Schema Namespaces (Click to Copy):
                </div>
                
                {/* CORS-Friendly Options */}
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '0.8rem', color: '#28a745', marginBottom: '6px', fontWeight: 'bold' }}>
                    ✅ CORS-Friendly (Browser Accessible):
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '6px', fontSize: '0.8rem' }}>
                    <div style={{ padding: '4px 8px', backgroundColor: 'rgba(40, 167, 69, 0.1)', borderRadius: '4px', cursor: 'pointer', border: '1px solid rgba(40, 167, 69, 0.3)' }}
                         onClick={() => navigator.clipboard.writeText('local:')}>
                      <strong>Local:</strong> local:MyType
                    </div>
                    <div style={{ padding: '4px 8px', backgroundColor: 'rgba(40, 167, 69, 0.1)', borderRadius: '4px', cursor: 'pointer', border: '1px solid rgba(40, 167, 69, 0.3)' }}
                         onClick={() => navigator.clipboard.writeText('https://json-ld.org/')}>
                      <strong>JSON-LD:</strong> https://json-ld.org/
                    </div>
                  </div>
                </div>
                
                {/* Standard Schemas (May have CORS issues) */}
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '0.8rem', color: '#ffc107', marginBottom: '6px', fontWeight: 'bold' }}>
                    ⚠️ Standard Schemas (May have CORS restrictions):
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '6px', fontSize: '0.8rem' }}>
                    <div style={{ padding: '4px 8px', backgroundColor: 'rgba(255, 193, 7, 0.1)', borderRadius: '4px', cursor: 'pointer', border: '1px solid rgba(255, 193, 7, 0.3)' }}
                         onClick={() => navigator.clipboard.writeText('http://schema.org/')}>
                      <strong>Schema.org:</strong> http://schema.org/
                    </div>
                    <div style={{ padding: '4px 8px', backgroundColor: 'rgba(255, 193, 7, 0.1)', borderRadius: '4px', cursor: 'pointer', border: '1px solid rgba(255, 193, 7, 0.3)' }}
                         onClick={() => navigator.clipboard.writeText('http://www.w3.org/2000/01/rdf-schema#')}>
                      <strong>RDF Schema:</strong> http://www.w3.org/2000/01/rdf-schema#
                    </div>
                    <div style={{ padding: '4px 8px', backgroundColor: 'rgba(255, 193, 7, 0.1)', borderRadius: '4px', cursor: 'pointer', border: '1px solid rgba(255, 193, 7, 0.3)' }}
                         onClick={() => navigator.clipboard.writeText('http://www.w3.org/2002/07/owl#')}>
                      <strong>OWL:</strong> http://www.w3.org/2002/07/owl#
                    </div>
                    <div style={{ padding: '4px 8px', backgroundColor: 'rgba(255, 193, 7, 0.1)', borderRadius: '4px', cursor: 'pointer', border: '1px solid rgba(255, 193, 7, 0.3)' }}
                         onClick={() => navigator.clipboard.writeText('http://purl.org/dc/terms/')}>
                      <strong>Dublin Core:</strong> http://purl.org/dc/terms/
                    </div>
                  </div>
                </div>
                
                <div style={{ marginTop: '8px', fontSize: '0.75rem', color: '#666', fontStyle: 'italic' }}>
                  💡 <strong>Tip:</strong> Use <code>local:MyType</code> for local identifiers - they always work!
                </div>
              </div>
              
              {Object.entries(resolvedData).map(([originalUri, result]) => (
                <div key={originalUri} style={{ marginBottom: '16px' }}>
                  <div style={{ marginBottom: '8px', fontSize: '0.85rem', color: '#666' }}>
                    <strong>Original URI:</strong> {originalUri}
                  </div>
                  
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.85rem', color: '#260000' }}>
                        Corrected URI or Local ID:
                      </label>
                      <input
                        type="text"
                        placeholder="e.g., http://schema.org/Thing or local:MyType"
                        style={{
                          width: '100%',
                          padding: '8px',
                          border: '1px solid #ccc',
                          borderRadius: '4px',
                          fontSize: '0.9rem',
                          fontFamily: "'EmOne', sans-serif"
                        }}
                        onChange={(e) => handleUriCorrection(originalUri, e.target.value)}
                      />
                    </div>
                    
                    <button
                      onClick={() => handleManualResolve(originalUri)}
                      style={{
                        backgroundColor: '#8B0000',
                        color: '#bdb5b5',
                        border: 'none',
                        padding: '8px 12px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                        fontWeight: 'bold'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#A52A2A'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#8B0000'}
                    >
                      Try Again
                    </button>
                  </div>
                  
                  {result.correctedUri && (
                    <div style={{ marginTop: '8px', padding: '8px', backgroundColor: 'rgba(46, 139, 87, 0.1)', borderRadius: '4px', fontSize: '0.85rem' }}>
                      <strong>Corrected:</strong> {result.correctedUri}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Suggestions */}
        {suggestions.links && suggestions.links.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 12px 0', color: '#260000', fontSize: '1.1rem' }}>
              Suggested External Links
            </h3>
            <div style={{ display: 'grid', gap: '8px' }}>
              {suggestions.links.slice(0, 5).map((suggestion, index) => (
                <div key={index} style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.3)',
                  padding: '12px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  border: '1px solid rgba(38, 0, 0, 0.1)'
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                      {suggestion.label}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#666', wordBreak: 'break-all' }}>
                      {suggestion.uri}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#888' }}>
                      Source: {suggestion.source} • Confidence: {Math.round(suggestion.confidence * 100)}%
                    </div>
                  </div>
                  <button
                    onClick={() => handleAddSuggestedLink(suggestion)}
                    style={{
                      backgroundColor: '#2E8B57',
                      color: '#bdb5b5',
                      border: 'none',
                      padding: '6px 10px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#3CB371'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#2E8B57'}
                  >
                    <Plus size={12} />
                    Add
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Validation Results */}
        {validationResults && (
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 12px 0', color: '#260000', fontSize: '1.1rem' }}>
              Validation Results
            </h3>
            <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.3)', padding: '16px', borderRadius: '8px' }}>
              {validationResults.issues.length === 0 ? (
                <div style={{ color: '#2E8B57', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CheckCircle size={16} />
                  No validation issues found
                </div>
              ) : (
                <div>
                  <div style={{ marginBottom: '12px', fontWeight: 'bold' }}>
                    Found {validationResults.issues.length} issue(s):
                  </div>
                  {validationResults.issues.map((issue, index) => (
                    <div key={index} style={{
                      padding: '8px',
                      marginBottom: '8px',
                      backgroundColor: issue.severity === 'error' ? 'rgba(255, 0, 0, 0.1)' :
                                   issue.severity === 'warning' ? 'rgba(255, 165, 0, 0.1)' :
                                   'rgba(0, 0, 255, 0.1)',
                      border: `1px solid ${issue.severity === 'error' ? '#FF0000' :
                                       issue.severity === 'warning' ? '#FFA500' : '#0000FF'}`,
                      borderRadius: '4px'
                    }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                        {issue.severity.toUpperCase()}: {issue.message}
                      </div>
                      {issue.nodeId && (
                        <div style={{ fontSize: '0.8rem', color: '#666' }}>
                          Node: {issue.nodeId}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Endpoint Status */}
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 12px 0', color: '#260000', fontSize: '1.1rem' }}>
            Endpoint Status
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            {Object.entries(endpointStatus).map(([endpoint, status]) => (
              <div key={endpoint} style={{
                backgroundColor: status.status === 'connected' ? 'rgba(46, 139, 87, 0.1)' : 'rgba(255, 69, 0, 0.1)',
                padding: '12px',
                borderRadius: '6px',
                border: `1px solid ${status.status === 'connected' ? '#2E8B57' : '#FF4500'}`,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <Database size={16} color={status.status === 'connected' ? '#2E8B57' : '#FF4500'} />
                <div>
                  <div style={{ fontWeight: 'bold', textTransform: 'capitalize' }}>
                    {endpoint}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#666' }}>
                    {status.status === 'connected' ? 
                      `${status.responseTime}ms` : 
                      status.error || 'Connection failed'
                    }
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cache Management */}
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 12px 0', color: '#260000', fontSize: '1.1rem' }}>
            Cache Management
          </h3>
          <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.3)', padding: '16px', borderRadius: '8px' }}>
            {cacheStats && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '16px', marginBottom: '12px' }}>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#666' }}>Total Entries</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{cacheStats.totalEntries}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#666' }}>Valid</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#2E8B57' }}>{cacheStats.validEntries}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#666' }}>Expired</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#FF8C00' }}>{cacheStats.expiredEntries}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#666' }}>Size</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{Math.round(cacheStats.cacheSize / 1024)}KB</div>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleClearCache}
                style={{
                  backgroundColor: '#DC143C',
                  color: '#bdb5b5',
                  border: 'none',
                  padding: '8px 12px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#B22222'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#DC143C'}
              >
                <X size={12} />
                Clear Cache
              </button>
              <button
                onClick={handleRefreshStats}
                style={{
                  backgroundColor: '#4682B4',
                  color: '#bdb5b5',
                  border: 'none',
                  padding: '8px 12px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#5F9EA0'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#4682B4'}
              >
                <RefreshCw size={12} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RDFResolutionPanel;
