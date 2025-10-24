import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Globe, Link, Book, Search, ExternalLink, Plus, X, Check, Tags, FileText, Eye, Settings, CheckCircle, RotateCcw, Zap, Loader2, AlertCircle, CheckSquare } from 'lucide-react';
import { PANEL_CLOSE_ICON_SIZE } from '../constants';
import { rdfResolver } from '../services/rdfResolver.js';
import { enrichFromSemanticWeb, fastEnrichFromSemanticWeb } from '../services/semanticWebQuery.js';
import { knowledgeFederation } from '../services/knowledgeFederation.js';
import useGraphStore from '../store/graphStore.jsx';

// DOI validation regex
const DOI_REGEX = /^10\.\d{4,}\/[-._;()\/:a-zA-Z0-9]+$/;

// URL validation for academic sources
const isValidURL = (string) => {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
};

// Extract DOI from various URL formats
const extractDOI = (input) => {
  // Direct DOI format
  if (DOI_REGEX.test(input)) return input;
  
  // DOI URL formats
  const doiUrlMatch = input.match(/(?:https?:\/\/)?(?:www\.)?(?:dx\.)?doi\.org\/(10\.\d{4,}\/[-._;()\/:a-zA-Z0-9]+)/);
  if (doiUrlMatch) return doiUrlMatch[1];
  
  // PubMed URL with DOI
  const pubmedMatch = input.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/);
  if (pubmedMatch) return `pubmed:${pubmedMatch[1]}`;
  
  return null;
};

const SemanticLinkInput = ({ onAdd, placeholder, type, icon: Icon, defaultValue = '' }) => {
  const [input, setInput] = useState(defaultValue);
  const [isValid, setIsValid] = useState(false);

  const validateInput = useCallback((value) => {
    if (type === 'doi') {
      return DOI_REGEX.test(value) || extractDOI(value) !== null;
    }
    return isValidURL(value);
  }, [type]);

  // Update input when defaultValue changes
  useEffect(() => {
    if (defaultValue && input === '') {
      setInput(defaultValue);
      setIsValid(validateInput(defaultValue));
    }
  }, [defaultValue, validateInput]);

  const handleInputChange = (e) => {
    const value = e.target.value;
    setInput(value);
    setIsValid(validateInput(value));
  };

  const handleAdd = () => {
    if (!isValid) return;
    
    let processedValue = input;
    if (type === 'doi') {
      const extracted = extractDOI(input);
      if (extracted) {
        processedValue = extracted.startsWith('10.') ? `doi:${extracted}` : extracted;
      }
    }
    
    onAdd(processedValue);
    setInput('');
    setIsValid(false);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && isValid) {
      handleAdd();
    }
  };

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: 1 }}>
      <Icon size={16} style={{ color: '#260000', marginTop: '1px' }} />
      <input
        type="text"
        value={input}
        onChange={handleInputChange}
        onKeyPress={handleKeyPress}
        placeholder={placeholder}
        style={{
          flex: 1,
          padding: '6px 8px',
          border: `1px solid ${isValid ? '#28a745' : (input ? '#dc3545' : '#8B0000')}`,
          borderRadius: '6px',
          fontSize: '14px',
          fontFamily: "'EmOne', sans-serif",
          backgroundColor: 'transparent'
        }}
      />
      <button
        onClick={handleAdd}
        disabled={!isValid}
        style={{
          padding: '6px 10px',
          border: '1px solid #8B0000',
          borderRadius: '6px',
          backgroundColor: isValid ? '#8B0000' : 'transparent',
          color: isValid ? '#EFE8E5' : '#8B0000',
          cursor: isValid ? 'pointer' : 'not-allowed',
          fontSize: '12px'
        }}
      >
        Add
      </button>
    </div>
  );
};

const ExternalLinkCard = ({ link, onRemove, provenance = null }) => {
  const [wikidataLabel, setWikidataLabel] = useState(null);

  const extractWikidataId = (uri) => {
    if (!uri) return null;
    if (uri.startsWith('wd:')) return uri.replace('wd:', '').trim();
    try {
      const u = new URL(uri);
      if (u.hostname.includes('wikidata.org')) {
        const parts = u.pathname.split('/').filter(Boolean);
        // typical: /wiki/Q42
        const last = parts[parts.length - 1] || '';
        if (/^Q\d+$/i.test(last)) return last;
      }
    } catch {}
    return null;
  };

  useEffect(() => {
    const qid = extractWikidataId(link);
    if (!qid) { setWikidataLabel(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&format=json&origin=*`);
        if (!resp.ok) return;
        const data = await resp.json();
        const entity = data?.entities?.[qid];
        if (!entity) return;
        const labels = entity.labels || {};
        const label = labels.en?.value || Object.values(labels)[0]?.value || null;
        if (!cancelled) setWikidataLabel(label || null);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [link]);
  const getDisplayInfo = (uri) => {
    const wikipediaStyleColor = '#000000';
    if (uri.startsWith('doi:')) {
      return {
        type: 'DOI',
        display: uri.replace('doi:', ''),
        url: `https://doi.org/${uri.replace('doi:', '')}`,
        color: '#ff6b35',
        desc: 'Digital Object Identifier'
      };
    } else if (uri.startsWith('pubmed:')) {
      return {
        type: 'PubMed',
        display: uri.replace('pubmed:', ''),
        url: `https://pubmed.ncbi.nlm.nih.gov/${uri.replace('pubmed:', '')}`,
        color: '#0066cc',
        desc: 'PubMed record'
      };
    } else if (uri.startsWith('wd:')) {
      return {
        type: 'Wikidata',
        display: uri.replace('wd:', ''),
        url: `https://www.wikidata.org/wiki/${uri.replace('wd:', '')}`,
        color: wikipediaStyleColor,
        desc: 'Structured data from Wikidata'
      };
    } else if (uri.includes('wikidata.org')) {
      const last = uri.split('/').pop();
      const pretty = last || 'Wikidata Entity';
      return {
        type: 'Wikidata',
        display: pretty,
        url: uri,
        color: wikipediaStyleColor,
        desc: 'Structured data from Wikidata'
      };
    } else if (uri.includes('wikipedia.org')) {
      const last = uri.split('/').pop();
      const pretty = last ? decodeURIComponent(last).replace(/_/g, ' ') : 'Wikipedia Article';
      return {
        type: 'Wikipedia',
        display: pretty,
        url: uri,
        color: wikipediaStyleColor,
        desc: 'Wikipedia article'
      };
    } else if (uri.includes('arxiv.org')) {
      return {
        type: 'arXiv',
        display: uri.split('/').pop(),
        url: uri,
        color: '#b31b1b',
        desc: 'arXiv preprint'
      };
    } else if (uri.includes('dbpedia.org')) {
      const resource = uri.split('/').pop();
      const pretty = resource ? decodeURIComponent(resource).replace(/_/g, ' ') : 'DBpedia Resource';
      return {
        type: 'DBpedia',
        display: pretty,
        url: uri,
        color: wikipediaStyleColor,
        desc: 'Structured data from DBpedia'
      };
    } else if (uri.includes('schema.org')) {
      return {
        type: 'Schema.org',
        display: uri.split('/').pop() || 'Schema Type',
        url: uri,
        color: '#0066cc',
        desc: 'Schema.org vocabulary'
      };
    } else {
      return {
        type: 'URL',
        display: uri.replace(/^https?:\/\//, '').substring(0, 40) + '...',
        url: uri,
        color: '#666',
        desc: undefined
      };
    }
  };

  const { type, display, url, color, desc } = getDisplayInfo(link);
  const finalDisplay = wikidataLabel || display;
  const prov = provenance;
  const contextText = (() => {
    if (!prov) return null;
    if (typeof prov.confidence === 'number') return `Confidence ${Math.round(prov.confidence * 100)}%`;
    return null;
  })();

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 10px',
      border: `1px solid ${color}`,
      borderRadius: '8px',
      marginBottom: '6px',
      minWidth: 0
    }}>
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: '12px',
          fontWeight: 'bold',
          color: color,
          marginBottom: '2px'
        }}>
          {type}
        </div>
        <div style={{
          fontSize: '12px',
          color: '#666',
          fontFamily: "'EmOne', sans-serif",
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          {finalDisplay}
        </div>
        {contextText && (
          <div
            title={prov?.appliedAt ? `Applied ${new Date(prov.appliedAt).toLocaleString()}` : undefined}
            style={{ fontSize: '10px', color: '#999', marginTop: '2px' }}
          >
            {contextText}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center' }}>
        <button
          onClick={() => window.open(url, '_blank')}
          style={{
            width: '32px',
            height: '28px',
            border: 'none',
            backgroundColor: 'transparent',
            cursor: 'pointer',
            color: color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title="Open external link"
        >
          <ExternalLink size={16} />
        </button>
        <button
          onClick={() => onRemove(link)}
          style={{
            width: '28px',
            height: '28px',
            border: 'none',
            backgroundColor: '#8B0000',
            color: '#EFE8E5',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            maxHeight: '28px'
          }}
          title="Remove link"
        >
          <span style={{ fontWeight: 'bold', fontSize: '16px' }}>×</span>
        </button>
      </div>
    </div>
  );
};

// Compact card container for visual hierarchy without full-width dividers
const SectionCard = ({ title, icon: Icon, rightEl = null, children, style = {} }) => {
  return (
    <div
      style={{
        border: '1px solid rgba(38,0,0,0.10)',
        borderLeft: '3px solid #8B0000',
        background: 'rgba(38,0,0,0.03)',
        borderRadius: '8px',
        padding: '10px',
        marginBottom: '10px',
        overflow: 'hidden',
        ...style
      }}
    >
      {(title || rightEl) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          {title ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {Icon && <Icon size={14} style={{ color: '#260000' }} />}
              <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#260000' }}>{title}</div>
            </div>
          ) : <span />}
          {rightEl}
        </div>
      )}
      {children}
    </div>
  );
};

const WikipediaSearch = ({ onSelect }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const searchWikipedia = async (searchTerm) => {
    if (!searchTerm.trim()) return;
    
    setLoading(true);
    try {
      // Use search API first for better semantic results
      const searchResponse = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/search?q=${encodeURIComponent(searchTerm)}&limit=10`
      );
      
      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        if (searchData.pages && searchData.pages.length > 0) {
          setResults(searchData.pages);
        } else {
          // If no search results, try exact page match as fallback
          const exactResponse = await fetch(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(searchTerm)}`
          );
          
          if (exactResponse.ok) {
            const data = await exactResponse.json();
            setResults([{
              title: data.title,
              description: data.extract,
              url: data.content_urls.desktop.page,
              thumbnail: data.thumbnail?.source
            }]);
          } else {
            setResults([]);
          }
        }
      } else {
        setResults([]);
      }
    } catch (error) {
      console.warn('Wikipedia search failed:', error);
      setResults([]);
    }
    setLoading(false);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      searchWikipedia(query);
    }
  };

  // Handle Wikipedia URL input
  const handleDirectURL = (input) => {
    const wikipediaMatch = input.match(/(?:https?:\/\/)?(?:www\.)?(?:en\.)?wikipedia\.org\/wiki\/(.+)/);
    if (wikipediaMatch) {
      return input;
    }
    return null;
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setQuery(value);
    
    // If it looks like a Wikipedia URL, clear results to indicate it's ready
    if (handleDirectURL(value)) {
      setResults([]);
    }
  };

  const handleSearch = () => {
    // Check if it's a direct Wikipedia URL first
    const directURL = handleDirectURL(query);
    if (directURL) {
      onSelect(directURL);
      setQuery('');
      return;
    }
    
    // Otherwise, search
    searchWikipedia(query);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'center' }}>
        <Globe size={16} style={{ color: '#666', marginTop: '1px', flexShrink: 0 }} />
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyPress={handleKeyPress}
          placeholder="Search Wikipedia or paste URL..."
          style={{
            flex: 1,
            padding: '6px 8px',
            border: '1px solid #260000',
            borderRadius: '4px',
            fontSize: '14px',
            fontFamily: "'EmOne', sans-serif"
          }}
        />
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          style={{
            width: '32px',
            height: '32px',
            border: 'none',
            borderRadius: '6px',
            backgroundColor: '#8B0000',
            color: '#EFE8E5',
            cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
            opacity: loading || !query.trim() ? 0.5 : 1
          }}
          onMouseEnter={(e) => !(loading || !query.trim()) && (e.target.style.backgroundColor = '#A00000')}
          onMouseLeave={(e) => !(loading || !query.trim()) && (e.target.style.backgroundColor = '#8B0000')}
        >
          {loading ? '...' : <span style={{ fontSize: '18px', color: '#EFE8E5', lineHeight: 1 }}>⌕</span>}
        </button>
      </div>

      {results.length > 0 && (
        <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
          {results.map((result, index) => (
            <div
              key={index}
              style={{
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                marginBottom: '6px',
                cursor: 'pointer',
                backgroundColor: '#f8f9fa',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start'
              }}
            >
              <div 
                onClick={() => onSelect(result.url || `https://en.wikipedia.org/wiki/${result.title}`)}
                style={{ flex: 1 }}
              >
                <div style={{
                  fontWeight: 'bold',
                  fontSize: '14px',
                  marginBottom: '4px',
                  color: '#333'  // Dark title
                }}>
                  {result.title}
                </div>
                {result.description && (
                  <div style={{
                    fontSize: '12px',
                    color: '#666',
                    lineHeight: 1.3
                  }}>
                    {result.description.substring(0, 100)}...
                  </div>
                )}
              </div>
              <button
                onClick={() => window.open(result.url || `https://en.wikipedia.org/wiki/${result.title}`, '_blank')}
                style={{
                  padding: '4px',
                  border: 'none',
                  backgroundColor: 'transparent',
                  cursor: 'pointer',
                  color: '#8B0000',
                  marginLeft: '8px'
                }}
                title="Open in Wikipedia"
              >
                <ExternalLink size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const RDFSchemaPropertiesSection = ({ nodeData, onUpdate }) => {
  const [rdfsSeeAlso, setRdfsSeeAlso] = useState((nodeData['rdfs:seeAlso'] || []).join(', '));

  const handleSeeAlsoBlur = () => {
    const seeAlsoArray = rdfsSeeAlso
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    onUpdate({
      ...nodeData,
      'rdfs:seeAlso': seeAlsoArray
    });
  };

  const handleSeeAlsoKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.target.blur();
    }
  };

  return (
    <SectionCard title="RDF Schema" icon={Tags}>
      {/* Auto-synced RDF properties */}
      <div style={{ fontSize: '14px', marginBottom: 6 }}>
        <div style={{ marginBottom: 4, color: '#260000' }}>
          <strong>rdfs:label:</strong> <code>"{nodeData.name || 'Untitled'}"</code>
        </div>
        <div style={{ marginBottom: 0, color: '#260000' }}>
          <strong>rdfs:comment:</strong> <code>"{(nodeData.description || 'No description').substring(0, 60)}{(nodeData.description || '').length > 60 ? '...' : ''}"</code>
          <ProvenanceBadge provenance={nodeData.semanticProvenance} field="description" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, color: '#260000', fontSize: '12px' }}>
          <CheckCircle size={14} style={{ color: '#260000' }} /> Auto-synced
        </div>
      </div>

      {/* rdfs:seeAlso */}
      <div>
        <div style={{ fontSize: '14px', color: '#8B0000', fontWeight: 'bold', marginBottom: 6 }}>See Also</div>
        <input
          type="text"
          value={rdfsSeeAlso}
          onChange={(e) => setRdfsSeeAlso(e.target.value)}
          onBlur={handleSeeAlsoBlur}
          onKeyPress={handleSeeAlsoKeyPress}
          placeholder="https://example.com/related, https://other.com/resource"
          style={{
            width: '100%',
            padding: '6px 8px',
            border: '1px solid #8B0000',
            borderRadius: '6px',
            fontSize: '14px',
            fontFamily: "'EmOne', sans-serif",
            backgroundColor: 'transparent',
            boxSizing: 'border-box'
          }}
        />
        <div style={{ fontSize: '12px', color: '#260000', marginTop: 2 }}>Comma-separated URLs</div>
      </div>
    </SectionCard>
  );
};

const titleCase = (s = '') => s
  .split(/\s+|_/)
  .filter(Boolean)
  .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
  .join(' ');

const SemanticClassificationSection = ({ nodeData, onUpdate }) => {
  // Store access for types
  const nodePrototypesMap = useGraphStore(state => state.nodePrototypes);
  const addNodePrototype = useGraphStore(state => state.addNodePrototype);
  const setNodeType = useGraphStore(state => state.setNodeType);
  const openRightPanelNodeTab = useGraphStore(state => state.openRightPanelNodeTab);

  const equivalentClasses = nodeData.equivalentClasses || [];
  const abstractionChains = nodeData.abstractionChains || {};

  const typePrototype = useMemo(() => {
    if (!nodeData.typeNodeId) return null;
    return nodePrototypesMap.get(nodeData.typeNodeId) || null;
  }, [nodeData.typeNodeId, nodePrototypesMap]);

  const addEquivalentClass = (uri, source = 'manual') => {
    const updatedClasses = [...equivalentClasses, { "@id": uri, "source": source }];
    onUpdate({
      ...nodeData,
      equivalentClasses: updatedClasses
    });
  };

  const removeEquivalentClass = (uri) => {
    const updatedClasses = equivalentClasses.filter(cls => cls['@id'] !== uri);
    onUpdate({
      ...nodeData,
      equivalentClasses: updatedClasses
    });
  };

  const deriveNameFromUri = (uri) => {
    if (!uri) return 'Type';
    let raw = uri;
    const colonIdx = uri.indexOf(':');
    if (colonIdx > -1) raw = uri.slice(colonIdx + 1);
    try {
      raw = decodeURIComponent(raw);
    } catch {}
    raw = raw.split('/').pop() || raw;
    raw = raw.replace(/_/g, ' ');
    return titleCase(raw);
  };

  const promoteClassToType = (uri) => {
    const prettyName = deriveNameFromUri(uri);
    // Try to find existing prototype by normalized name (case-insensitive)
    let existing = null;
    for (const proto of nodePrototypesMap.values()) {
      if ((proto.name || '').toLowerCase() === prettyName.toLowerCase()) {
        existing = proto;
        break;
      }
    }
    let targetTypeId = existing?.id;
    if (!targetTypeId) {
      // Create new type prototype (avoid bloat by reusing name; user can merge later if needed)
      const newTypeId = `type-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      addNodePrototype({
        id: newTypeId,
        name: prettyName,
        description: '',
        color: '#8B0000',
        typeNodeId: null,
        definitionGraphIds: []
      });
      targetTypeId = newTypeId;
    }
    // Set as primary type
    setNodeType(nodeData.id, targetTypeId);
  };

  // Common ontology mappings
  const commonOntologies = [
    { id: 'schema:Person', name: 'Person (Schema.org)', color: '#4285f4' },
    { id: 'foaf:Person', name: 'Person (FOAF)', color: '#34a853' },
    { id: 'dbo:Person', name: 'Person (DBpedia)', color: '#ea4335' },
    { id: 'schema:Organization', name: 'Organization (Schema.org)', color: '#4285f4' },
    { id: 'foaf:Organization', name: 'Organization (FOAF)', color: '#34a853' },
    { id: 'schema:CreativeWork', name: 'Creative Work (Schema.org)', color: '#4285f4' },
    { id: 'schema:Thing', name: 'Thing (Schema.org)', color: '#4285f4' }
  ];

  return (
    <SectionCard
      title="Semantic Classification"
      icon={Search}
    >
      {/* Primary Type chip */}
      <div style={{ marginBottom: '8px' }}>
        <div style={{ fontSize: '14px', color: '#8B0000', fontWeight: 'bold', marginBottom: 6 }}>Primary Type</div>
        {typePrototype ? (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            background: typePrototype.color || '#8B0000',
            color: '#bdb5b5',
            borderRadius: '12px',
            border: '1px solid rgba(0,0,0,0.15)',
            cursor: 'pointer'
          }}
          onClick={() => openRightPanelNodeTab?.(typePrototype.id)}
          title="Open type"
          >
            <span style={{ fontWeight: 'bold' }}>{titleCase(typePrototype.name || 'Thing')}</span>
            <span style={{ fontSize: '10px', opacity: 0.8 }}>(type)</span>
          </div>
        ) : (
          <div style={{ fontSize: '12px', color: '#260000' }}>None set</div>
        )}
      </div>

      {/* Quick Ontology Mappings */}
      <div style={{ marginBottom: '6px' }}>
        <label style={{ 
          display: 'block', 
          fontSize: '14px', 
          color: '#8B0000',
          marginBottom: '6px',
          fontWeight: 'bold'
        }}>
          Quick Classifications (owl:equivalentClass):
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {commonOntologies.map(onto => {
            const isSelected = equivalentClasses.some(cls => cls['@id'] === onto.id);
            return (
              <button
                key={onto.id}
                onClick={() => isSelected 
                  ? removeEquivalentClass(onto.id)
                  : addEquivalentClass(onto.id, 'quick-select')
                }
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  border: `1px solid ${onto.color}`,
                  backgroundColor: isSelected ? onto.color : '#DEDADA',
                  color: isSelected ? '#EFE8E5' : onto.color,
                  borderRadius: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                {onto.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Current Classifications */}
      {equivalentClasses.length > 0 && (
        <div style={{ marginTop: 6 }}>
                  <label style={{ 
          display: 'block', 
          fontSize: '14px', 
          color: '#8B0000', 
          marginBottom: '6px',
          fontWeight: 'bold'
        }}>
          Current Classifications ({equivalentClasses.length}):
        </label>
          {equivalentClasses.map((cls, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 8px',
                backgroundColor: 'transparent',
                border: '1px solid #ddd',
                borderRadius: '4px',
                marginBottom: '6px',
                fontSize: '14px'
              }}
            >
              <div>
                <code style={{ 
                  backgroundColor: 'rgba(0,0,0,0.03)', 
                  padding: '2px 4px', 
                  borderRadius: '3px',
                  fontSize: '12px',
                  color: '#260000'
                }}>
                  {cls['@id']}
                </code>
                {cls.source && (
                  <span style={{ 
                    marginLeft: '8px', 
                    fontSize: '11px', 
                    color: '#260000',
                    fontStyle: 'italic'
                  }}>
                    via {cls.source}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => promoteClassToType(cls['@id'])}
                  style={{
                    padding: '3px 8px',
                    border: '1px solid #8B0000',
                    background: 'transparent',
                    color: '#8B0000',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    lineHeight: 1
                  }}
                  title="Promote this external class to a local Type and set as Primary"
                >
                  Promote to Type
                </button>
                <button
                  onClick={() => removeEquivalentClass(cls['@id'])}
                  style={{
                    padding: '3px 8px',
                    border: 'none',
                    backgroundColor: '#dc3545',
                    color: '#EFE8E5',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1
                  }}
                >
                  <X size={14} strokeWidth={3} style={{ color: '#EFE8E5' }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Abstraction Chains - Future Feature */}
      {Object.keys(abstractionChains).length > 0 && (
        <div style={{ marginTop: '15px' }}>
          <label style={{ 
            display: 'block', 
            fontSize: '14px', 
            color: '#8B0000', 
            marginBottom: '8px',
            fontWeight: 'bold'
          }}>
            Abstraction Chains:
          </label>
          <div style={{ 
            fontSize: '12px', 
            color: '#260000', 
            fontStyle: 'italic',
            marginTop: '8px'
          }}>
            Future: These will be automatically mapped to rdfs:subClassOf relationships
          </div>
        </div>
      )}
    </SectionCard>
  );
};

// Provenance badge component
const ProvenanceBadge = ({ provenance, field }) => {
  if (!provenance || !provenance[field]) return null;
  
  const p = provenance[field];
  const sourceText = p.source === 'multi_source' ? 'Multi' : 
                    p.source === 'single_strong' ? 'Single' : 'Auto';
  
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: '7px',
        fontFamily: "'EmOne', sans-serif",
        backgroundColor: 'rgba(139, 0, 0, 0.1)',
        color: '#8B0000',
        padding: '1px 3px',
        borderRadius: '3px',
        marginLeft: '4px',
        cursor: 'help'
      }}
      title={`Auto-applied from ${sourceText} (${Math.round(p.confidence * 100)}% confidence) at ${new Date(p.appliedAt).toLocaleString()}`}
    >
      {sourceText}
    </span>
  );
};

const SemanticEditor = ({ nodeData, onUpdate, isUltraSlim = false }) => {
  const [enrichmentState, setEnrichmentState] = useState({
    isEnriching: false,
    progress: {},
    results: null,
    error: null
  });
  const [resolvedData, setResolvedData] = useState(new Map());
  const [federationState, setFederationState] = useState({
    isImporting: false,
    progress: { stage: '', entity: '', level: 0 },
    results: null,
    error: null
  });
  const [externalType, setExternalType] = useState('doi'); // 'doi' | 'wikipedia' | 'url'
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [autoApplied, setAutoApplied] = useState([]); // [{ field, prev, next, sourceMode, confidence, sourcesFound, ts }]
  const lastEnrichAtRef = React.useRef(0);
  const [lastSuggestionsMeta, setLastSuggestionsMeta] = useState(null); // { confidence, sourcesFound, items: [...] }
  const [semanticIdentityMode, setSemanticIdentityMode] = useState('read'); // 'read' | 'write' | 'consolidated'
  const [showConsolidatePreview, setShowConsolidatePreview] = useState(false);
  const [consolidatePreview, setConsolidatePreview] = useState(null);
  const [writeState, setWriteState] = useState({ isDirty: false, lastWrite: null, writeTarget: null });



  if (!nodeData) return null;

  const externalLinks = nodeData.externalLinks || [];

  // Initialize semantic identity mode from node data
  useEffect(() => {
    const nodeSemanticMode = nodeData.semanticIdentity?.mode || 'read';
    setSemanticIdentityMode(nodeSemanticMode);
  }, [nodeData.id]);

  // Update semantic identity schema on node
  const updateSemanticIdentity = (updates) => {
    const currentIdentity = nodeData.semanticIdentity || {
      mode: 'read',
      sources: [],
      targets: [],
      lastSync: null,
      syncMetadata: {},
      provenance: {}
    };
    
    const newIdentity = { ...currentIdentity, ...updates };
    onUpdate({ ...nodeData, semanticIdentity: newIdentity });
  };

  // Handle mode change
  const handleModeChange = (newMode) => {
    setSemanticIdentityMode(newMode);
    updateSemanticIdentity({ 
      mode: newMode,
      lastModeChange: new Date().toISOString()
    });
  };

  // Read sync pipeline: pull→diff→dedupe→apply with provenance
  const performReadSync = async () => {
    try {
      setEnrichmentState({ isEnriching: true, progress: { stage: 'Syncing from semantic web...' }, results: null, error: null });
      
      // Pull from semantic web
      const enrichmentResults = await fastEnrichFromSemanticWeb(nodeData.name, { timeout: 20000 });
      
      if (!enrichmentResults?.suggestions) {
        throw new Error('No semantic web data found');
      }
      
      // Create diff between current and incoming data
      const incoming = enrichmentResults.suggestions;
      const current = nodeData;
      const diff = {
        description: {
          current: current.description || '',
          incoming: incoming.description || '',
          changed: (current.description || '') !== (incoming.description || '')
        },
        externalLinks: {
          current: current.externalLinks || [],
          incoming: incoming.externalLinks || [],
          new: (incoming.externalLinks || []).filter(link => 
            !(current.externalLinks || []).includes(canonicalizeLink(link))
          )
        },
        equivalentClasses: {
          current: current.equivalentClasses || [],
          incoming: incoming.equivalentClasses || [],
          new: (incoming.equivalentClasses || []).filter(cls => 
            !(current.equivalentClasses || []).some(existing => 
              (existing['@id'] || existing.id || '').toLowerCase() === 
              (cls['@id'] || cls.id || '').toLowerCase()
            )
          )
        }
      };
      
      // Update semantic identity with sync metadata
      updateSemanticIdentity({
        lastSync: new Date().toISOString(),
        syncMetadata: {
          source: 'semantic_web',
          confidence: enrichmentResults.suggestions.confidence || 0,
          itemsFound: {
            descriptions: diff.description.changed ? 1 : 0,
            externalLinks: diff.externalLinks.new.length,
            equivalentClasses: diff.equivalentClasses.new.length
          }
        }
      });
      
      setEnrichmentState({ isEnriching: false, progress: {}, results: diff, error: null });
      return diff;
      
    } catch (error) {
      console.error('[ReadSync] Failed:', error);
      setEnrichmentState({ isEnriching: false, progress: {}, results: null, error: error.message });
      return null;
    }
  };

  // Consolidate preview function
  const generateConsolidatePreview = async () => {
    const readData = await performReadSync();
    if (!readData) return;
    
    // Create merged preview using simple merge logic
    const merged = {
      ...nodeData,
      description: readData.description.incoming || nodeData.description,
      externalLinks: [...(nodeData.externalLinks || []), ...readData.externalLinks.new],
      equivalentClasses: [...(nodeData.equivalentClasses || []), ...readData.equivalentClasses.new],
      lastConsolidated: new Date().toISOString()
    };
    
    setConsolidatePreview({ original: nodeData, merged, diff: readData });
    setShowConsolidatePreview(true);
  };

  // Apply consolidation
  const applyConsolidation = () => {
    if (consolidatePreview?.merged) {
      onUpdate(consolidatePreview.merged);
      updateSemanticIdentity({
        mode: 'consolidated',
        lastConsolidated: new Date().toISOString(),
        consolidatedFrom: ['local', 'semantic_web']
      });
    }
    setShowConsolidatePreview(false);
    setConsolidatePreview(null);
  };

  // Write pipeline: dirty tracking→push→error handling
  const performWrite = async (targetEndpoint = 'wikidata') => {
    try {
      if (!writeState.isDirty) {
        console.log('[WriteSync] No changes to write');
        return;
      }

      setEnrichmentState({ isEnriching: true, progress: { stage: 'Writing to semantic web...' }, results: null, error: null });
      
      // Guardrails: explicit writes only, single-source soft-apply
      const writeData = {
        name: nodeData.name,
        description: nodeData.description,
        externalLinks: nodeData.externalLinks || [],
        equivalentClasses: nodeData.equivalentClasses || [],
        writeMode: 'explicit', // Only explicit user-initiated writes
        target: targetEndpoint
      };
      
      // Simulate write operation (would be actual API call in production)
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Update write state and semantic identity
      setWriteState({ isDirty: false, lastWrite: new Date().toISOString(), writeTarget: targetEndpoint });
      updateSemanticIdentity({
        lastWrite: new Date().toISOString(),
        writeMetadata: {
          target: targetEndpoint,
          itemsWritten: {
            description: !!nodeData.description,
            externalLinks: (nodeData.externalLinks || []).length,
            equivalentClasses: (nodeData.equivalentClasses || []).length
          }
        }
      });
      
      setEnrichmentState({ isEnriching: false, progress: {}, results: { success: true, target: targetEndpoint }, error: null });
      
    } catch (error) {
      console.error('[WriteSync] Failed:', error);
      setEnrichmentState({ isEnriching: false, progress: {}, results: null, error: `Write failed: ${error.message}` });
    }
  };

  // Track dirty state when node data changes
  useEffect(() => {
    if (semanticIdentityMode === 'write') {
      setWriteState(prev => ({ ...prev, isDirty: true }));
    }
  }, [nodeData.description, JSON.stringify(nodeData.externalLinks), JSON.stringify(nodeData.equivalentClasses), semanticIdentityMode]);

  // Guardrails: prevent accidental auto-apply in write mode
  const isWriteModeGuarded = semanticIdentityMode === 'write';
  
  // Override auto-apply when in write mode (guardrail)
  const safeAutoApply = (updates) => {
    if (isWriteModeGuarded) {
      console.log('[Guardrail] Preventing auto-apply in write mode');
      return false;
    }
    onUpdate(updates);
    return true;
  };

  // Simple URI canonicalizer for dedupe
  const canonicalizeLink = (uri) => {
    try {
      const u = new URL(uri);
      u.hash = '';
      // strip common tracking params
      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(p => u.searchParams.delete(p));
      const pathname = u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : u.pathname;
      u.pathname = pathname;
      u.protocol = u.protocol.toLowerCase();
      u.hostname = u.hostname.toLowerCase();
      return u.toString();
    } catch {
      return uri.trim();
    }
  };

  const addExternalLink = (uri) => {
    const canon = canonicalizeLink(uri);
    const updatedLinks = Array.from(new Set([...(externalLinks || []).map(canonicalizeLink), canon]));
    onUpdate({
      ...nodeData,
      externalLinks: updatedLinks
    });
  };

  const removeExternalLink = (uri) => {
    const updatedLinks = externalLinks.filter(link => link !== uri);
    onUpdate({
      ...nodeData,
      externalLinks: updatedLinks
    });
  };

  // Handle semantic web enrichment
  const handleEnrichFromSemanticWeb = async () => {
    if (!nodeData?.name) return;
    
    setEnrichmentState({
      isEnriching: true,
      progress: {
        wikidata: 'pending',
        dbpedia: 'pending',
        wikipedia: 'pending'
      },
      results: null,
      error: null
    });

    try {
      // Update progress as we go
      setEnrichmentState(prev => ({
        ...prev,
        progress: { 
          wikidata: 'active', 
          dbpedia: 'pending', 
          wikipedia: 'pending' 
        }
      }));
      
      // Use our fast semantic web enrichment for immediate results
      const enrichmentResults = await fastEnrichFromSemanticWeb(nodeData.name, { timeout: 15000 });
      
      // Update progress to show completion
      setEnrichmentState(prev => ({
        ...prev,
        progress: {
          wikidata: enrichmentResults.sources.wikidata?.found ? 'completed' : 'failed',
          dbpedia: enrichmentResults.sources.dbpedia?.found ? 'completed' : 'failed',
          wikipedia: enrichmentResults.sources.wikipedia?.found ? 'completed' : 'failed'
        }
      }));
      
      // Set final results
      setEnrichmentState({
        isEnriching: false,
        progress: {},
        results: enrichmentResults.suggestions,
        error: null
      });

      // Auto-import when confidence >= 0.8
      try {
        const conf = Number(enrichmentResults?.suggestions?.confidence || 0);
        if (conf >= 0.8) {
          const updates = { ...nodeData };
          // Apply description if absent
          if (!updates.description && enrichmentResults.suggestions.description) {
            updates.description = enrichmentResults.suggestions.description;
            // Mark as auto-applied with provenance
            if (!updates.semanticProvenance) updates.semanticProvenance = {};
            updates.semanticProvenance.description = {
              source: sourceMode,
              confidence: conf,
              appliedAt: new Date().toISOString(),
              sourcesFound
            };
          }
          // Merge external links
          if (Array.isArray(enrichmentResults.suggestions.externalLinks) && enrichmentResults.suggestions.externalLinks.length > 0) {
            const existing = new Set((updates.externalLinks || []));
            const newLinks = [];
            enrichmentResults.suggestions.externalLinks.forEach(l => {
              if (!existing.has(l)) {
                newLinks.push(l);
              }
              existing.add(l);
            });
            updates.externalLinks = Array.from(existing);
            // Track provenance for new links
            if (newLinks.length > 0) {
              if (!updates.semanticProvenance) updates.semanticProvenance = {};
              if (!updates.semanticProvenance.externalLinks) updates.semanticProvenance.externalLinks = [];
              newLinks.forEach(link => {
                updates.semanticProvenance.externalLinks.push({
                  link,
                  source: sourceMode,
                  confidence: conf,
                  appliedAt: new Date().toISOString(),
                  sourcesFound
                });
              });
            }
          }
          // Merge equivalent classes if provided
          if (Array.isArray(enrichmentResults.suggestions.equivalentClasses) && enrichmentResults.suggestions.equivalentClasses.length > 0) {
            const prev = Array.isArray(updates.equivalentClasses) ? updates.equivalentClasses : [];
            const merged = [...prev, ...enrichmentResults.suggestions.equivalentClasses];
            updates.equivalentClasses = merged;
          }
          if (!safeAutoApply(updates)) {
            // Show as suggestions instead in write mode
            setEnrichmentState({
              isEnriching: false,
              progress: {},
              results: enrichmentResults.suggestions,
              error: null
            });
          }
        }
      } catch (e) {
        // Swallow auto-import errors silently but log
        console.warn('[SemanticEditor] Auto-import at 80% failed:', e);
      }
      
    } catch (error) {
      console.error('[SemanticEditor] Enrichment failed:', error);
      setEnrichmentState({
        isEnriching: false,
        progress: {},
        results: null,
        error: error.message
      });
    }
  };


  // Resolve external links to RDF data
  const resolveExternalLinks = async () => {
    const resolved = new Map();
    
    for (const link of externalLinks) {
      try {
        const rdfData = await rdfResolver.resolveURI(link, { timeout: 10000 });
        if (rdfData) {
          resolved.set(link, rdfData);
        }
      } catch (error) {
        console.warn(`Failed to resolve ${link}:`, error);
      }
    }
    
    setResolvedData(resolved);
    return resolved;
  };


  // Apply a suggestion to the node
  const applySuggestion = (type, value) => {
    if (type === 'externalLink') {
      addExternalLink(value);
    } else if (type === 'description' && !nodeData.description) {
      onUpdate({ ...nodeData, description: value });
    } else if (type === 'equivalentClass') {
      const prev = Array.isArray(nodeData.equivalentClasses) ? nodeData.equivalentClasses : [];
      const exists = prev.some(cls => (cls['@id'] || cls.id || '').toLowerCase() === (value['@id'] || value.id || '').toLowerCase());
      const updatedClasses = exists ? prev : [...prev, value];
      onUpdate({ ...nodeData, equivalentClasses: updatedClasses });
    }
  };

  // Debounced auto-enrich on name change - links only, no auto bio population
  useEffect(() => {
    const name = (nodeData?.name || '').trim();
    if (!name || name.toLowerCase() === 'new thing' || name.length < 3) return;
    const now = Date.now();
    const timeSince = now - (lastEnrichAtRef.current || 0);
    // throttle to at most once per 2s
    if (timeSince < 2000) return;
    const t = setTimeout(async () => {
      lastEnrichAtRef.current = Date.now();
      try {
        const enrichmentResults = await fastEnrichFromSemanticWeb(name, { timeout: 15000 });
        const conf = Number(enrichmentResults?.suggestions?.confidence || 0);
        const sources = enrichmentResults?.sources || {};
        const sourcesFound = ['wikidata','dbpedia','wikipedia'].reduce((n,k)=> n + (sources[k]?.found ? 1 : 0), 0);

        // simple title match check
        const clean = (s) => (s || '').toLowerCase().replace(/[_-]+/g,' ').replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();
        const nodeClean = clean(name);
        const suggestionTitle = enrichmentResults?.suggestions?.title || name; // fallback
        const suggClean = clean(suggestionTitle);
        const strongTitle = nodeClean && suggClean && (nodeClean === suggClean || nodeClean.includes(suggClean) || suggClean.includes(nodeClean));

        // NEVER auto-apply descriptions - user requested this be manual only
        const safeApplyDesc = false; // Disabled auto bio population
        const links = Array.isArray(enrichmentResults?.suggestions?.externalLinks) ? enrichmentResults.suggestions.externalLinks : [];

        // Apply policy: two sources + conf>=0.8 OR one strong source + conf>=0.9 and strong title
        // BUT only for external links, never for descriptions
        const oneStrongSource = (sources.wikipedia?.found || sources.wikidata?.found) && conf >= 0.9 && strongTitle;
        if ((sourcesFound >= 2 && conf >= 0.8) || oneStrongSource) {
          const updates = { ...nodeData };
          // Only add external links, never auto-populate description
          if (links.length > 0) {
            const canonMerged = new Set((updates.externalLinks || []).map(canonicalizeLink));
            links.forEach(l => canonMerged.add(canonicalizeLink(l)));
            updates.externalLinks = Array.from(canonMerged);
            onUpdate(updates);
            setAutoApplied(prev => [{ field: 'externalLinks', prev: null, next: 'applied', sourceMode: oneStrongSource ? 'single' : 'multi', confidence: conf, sourcesFound, ts: Date.now() }, ...prev].slice(0,5));
          }
        } else {
          // Present suggestions only, capture meta
          const items = (enrichmentResults?.suggestions?.externalLinks || []).slice(0,5);
          setLastSuggestionsMeta({
            confidence: conf,
            sourcesFound,
            items
          });
          setEnrichmentState({ isEnriching: false, progress: {}, results: enrichmentResults.suggestions, error: null });
        }
      } catch (e) {
        // no-op on failure
      }
    }, 600);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeData?.name]);



  // Handle mass knowledge import
  const handleMassImport = async () => {
    if (!nodeData?.name) return;
    
    setFederationState({
      isImporting: true,
      progress: { stage: 'initializing', entity: nodeData.name, level: 0 },
      results: null,
      error: null
    });

    try {
      const results = await knowledgeFederation.importKnowledgeCluster(
        nodeData.name,
        {
          maxDepth: 2,
          maxEntitiesPerLevel: 8,
          includeRelationships: true,
          includeSources: ['wikidata', 'dbpedia'],
          onProgress: (progressData) => {
            setFederationState(prev => ({
              ...prev,
              progress: progressData
            }));
          }
        }
      );

      setFederationState({
        isImporting: false,
        progress: { stage: 'complete', entity: '', level: 0 },
        results: results,
        error: null
      });

      console.log(`[SemanticEditor] Mass import completed: ${results.totalEntities} entities, ${results.totalRelationships} relationships`);
      
    } catch (error) {
      console.error('[SemanticEditor] Mass import failed:', error);
      setFederationState({
        isImporting: false,
        progress: { stage: 'failed', entity: '', level: 0 },
        results: null,
        error: error.message
      });
    }
  };


  return (
    <div style={{ 
      padding: '0 0 10px 0', 
      fontFamily: "'EmOne', sans-serif"
    }}>


      {/* RDF Schema Properties Section */}
      <RDFSchemaPropertiesSection 
        nodeData={nodeData} 
        onUpdate={onUpdate} 
      />

      {/* Classification inside Semantic Profile */}
      <div style={{ marginTop: '8px' }}>
        <SemanticClassificationSection 
          nodeData={nodeData} 
          onUpdate={onUpdate}
        />
      </div>

      {/* spacing only; avoid divider lines */}
      <div style={{ height: 8 }} />

      {/* External Links Section (Rosetta Stone) */}
      <SectionCard
        title="External References (owl:sameAs)"
        icon={Link}
      >
        {/* Unified reference input */}
        {isUltraSlim ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
            <select
              value={externalType}
              onChange={(e) => setExternalType(e.target.value)}
              style={{
                padding: '6px 8px',
                border: '1px solid #8B0000',
                borderRadius: '6px',
                fontSize: '14px',
                color: '#260000',
                background: 'transparent'
              }}
            >
              <option value="doi">DOI</option>
              <option value="wikipedia">Wikipedia</option>
              <option value="url">Other URL</option>
            </select>
            <SemanticLinkInput
              onAdd={addExternalLink}
              placeholder={externalType === 'doi' ? '10.1000/182 or https://doi.org/10.1000/182' : (externalType === 'wikipedia' ? 'https://en.wikipedia.org/wiki/...' : 'https://example.com/resource')}
              type={externalType === 'doi' ? 'doi' : 'url'}
              icon={externalType === 'doi' ? Book : ExternalLink}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
            <select
              value={externalType}
              onChange={(e) => setExternalType(e.target.value)}
              style={{
                padding: '6px 8px',
                border: '1px solid #8B0000',
                borderRadius: '6px',
                fontSize: '14px',
                color: '#260000',
                background: 'transparent'
              }}
            >
              <option value="doi">DOI</option>
              <option value="wikipedia">Wikipedia</option>
              <option value="url">Other URL</option>
            </select>
            <SemanticLinkInput
              onAdd={addExternalLink}
              placeholder={externalType === 'doi' ? '10.1000/182 or https://doi.org/10.1000/182' : (externalType === 'wikipedia' ? 'https://en.wikipedia.org/wiki/...' : 'https://example.com/resource')}
              type={externalType === 'doi' ? 'doi' : 'url'}
              icon={externalType === 'doi' ? Book : ExternalLink}
            />
          </div>
        )}

        {/* Display existing links */}
        {externalLinks.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ margin: '0 0 6px 0', fontSize: '14px', color: '#260000' }}>
              Linked Resources ({externalLinks.length})
            </div>
            {externalLinks.map((link, index) => {
              let prov = null;
              const provList = nodeData?.semanticProvenance?.externalLinks;
              if (Array.isArray(provList)) {
                prov = provList.find(p => p.link === link) || null;
              }
              return (
                <ExternalLinkCard
                  key={index}
                  link={link}
                  onRemove={removeExternalLink}
                  provenance={prov}
                />
              );
            })}
          </div>
        )}

        {/* Close Candidates (when confidence is midrange) */}
        {lastSuggestionsMeta && lastSuggestionsMeta.confidence >= 0.6 && lastSuggestionsMeta.confidence < 0.78 && (
          <div style={{ marginTop: '10px' }}>
            <h5 style={{ margin: '0 0 6px 0', fontSize: '14px', color: '#260000' }}>
              Close candidates
            </h5>
            {lastSuggestionsMeta.items.map((cand, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px dashed #ccc', borderRadius: '6px', padding: '6px 8px', marginBottom: '6px' }}>
                <code style={{ fontSize: '12px', padding: '2px 4px', background: 'rgba(0,0,0,0.05)', borderRadius: '2px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cand.substring(0, 80)}{cand.length > 80 ? '…' : ''}
                </code>
                <div style={{ display: 'flex', gap: '6px', marginLeft: '8px' }}>
                  <button onClick={() => addExternalLink(cand)} style={{ padding: '4px 8px', border: 'none', borderRadius: '4px', background: '#8B0000', color: '#EFE8E5', fontSize: '12px', cursor: 'pointer' }}>Use link</button>
                  {!nodeData.description && enrichmentState.results?.description && (
                    <button onClick={() => applySuggestion('description', enrichmentState.results.description)} style={{ padding: '4px 8px', border: '1px solid #ccc', borderRadius: '4px', background: 'transparent', color: '#260000', fontSize: '12px', cursor: 'pointer' }}>Replace description</button>
                  )}
                  <button onClick={() => {/* alias placeholder */}} style={{ padding: '4px 8px', border: '1px solid #ccc', borderRadius: '4px', background: 'transparent', color: '#260000', fontSize: '12px', cursor: 'pointer' }}>Add alias</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* spacing only; avoid divider lines */}
      <div style={{ height: 12 }} />

      {/* Semantic Web Actions */}
      <div style={{ marginTop: '12px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
          {/* Hidden: Enrich from Web button
          <button
            onClick={handleEnrichFromSemanticWeb}
            disabled={enrichmentState.isEnriching}
            style={{
              backgroundColor: enrichmentState.isEnriching ? '#666' : '#8B0000',
              color: '#EFE8E5',
              border: 'none',
              padding: '6px 10px',
              borderRadius: '4px',
              cursor: enrichmentState.isEnriching ? 'not-allowed' : 'pointer',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 'bold'
            }}
            onMouseEnter={(e) => !enrichmentState.isEnriching && (e.currentTarget.style.backgroundColor = '#A52A2A')}
            onMouseLeave={(e) => !enrichmentState.isEnriching && (e.currentTarget.style.backgroundColor = '#8B0000')}
            title="Enrich from semantic web (Wikidata, DBpedia)"
          >
            {enrichmentState.isEnriching ? <Loader2 size={14} style={{animation: 'spin 1s linear infinite'}} /> : <Zap size={14} />}
            {enrichmentState.isEnriching ? 'Enriching...' : 'Enrich from Web'}
          </button>
          */}
          
          {showAdvanced && (
          <button
            onClick={handleMassImport}
            disabled={enrichmentState.isEnriching || federationState.isImporting}
            style={{
              backgroundColor: (enrichmentState.isEnriching || federationState.isImporting) ? '#666' : '#4B0082',
              color: '#EFE8E5',
              border: 'none',
              padding: '6px 10px',
              borderRadius: '4px',
              cursor: (enrichmentState.isEnriching || federationState.isImporting) ? 'not-allowed' : 'pointer',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 'bold'
            }}
            onMouseEnter={(e) => !(enrichmentState.isEnriching || federationState.isImporting) && (e.currentTarget.style.backgroundColor = '#6A0DAD')}
            onMouseLeave={(e) => !(enrichmentState.isEnriching || federationState.isImporting) && (e.currentTarget.style.backgroundColor = '#4B0082')}
            title="Import entire knowledge cluster (entities + relationships)"
          >
            {federationState.isImporting ? <Loader2 size={14} style={{animation: 'spin 1s linear infinite'}} /> : <Globe size={14} />}
            {federationState.isImporting ? 'Importing...' : 'Mass Import'}
          </button>
          )}
          
          {showAdvanced && externalLinks.length > 0 && (
            <button
              onClick={resolveExternalLinks}
              disabled={enrichmentState.isEnriching}
              style={{
                backgroundColor: enrichmentState.isEnriching ? '#666' : '#2E8B57',
                color: '#EFE8E5',
                border: 'none',
                padding: '6px 10px',
                borderRadius: '4px',
                cursor: enrichmentState.isEnriching ? 'not-allowed' : 'pointer',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 'bold'
              }}
              onMouseEnter={(e) => !enrichmentState.isEnriching && (e.currentTarget.style.backgroundColor = '#3CB371')}
              onMouseLeave={(e) => !enrichmentState.isEnriching && (e.currentTarget.style.backgroundColor = '#2E8B57')}
              title="Resolve external links to RDF data"
            >
              <RotateCcw size={14} />
              Resolve Links
            </button>
          )}
        </div>

        {/* Optional Wikipedia helper under Advanced */}
        {showAdvanced && (
          <div style={{ marginTop: '6px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>Wikipedia Helper</label>
            <WikipediaSearch onSelect={addExternalLink} />
          </div>
        )}

        {/* Progress Display */}
        {enrichmentState.isEnriching && (
          <div style={{ 
            fontSize: '11px', 
            color: '#666'
          }}>
            <div style={{ marginBottom: '4px', fontWeight: 'bold' }}>Enriching from semantic web...</div>
            {Object.entries(enrichmentState.progress).map(([source, status]) => (
              <div key={source} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                {status === 'pending' && <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ccc' }} />}
                {status === 'active' && <Loader2 size={8} style={{ color: '#8B0000', animation: 'spin 1s linear infinite' }} />}
                {status === 'completed' && <CheckSquare size={8} style={{ color: '#2E8B57' }} />}
                <span>{source.replace('_', ' ')}...</span>
              </div>
            ))}
          </div>
        )}

        {/* Error Display */}
        {enrichmentState.error && (
          <div style={{
            fontSize: '11px',
            color: '#dc3545',
            padding: '8px',
            backgroundColor: 'rgba(220, 53, 69, 0.1)',
            borderRadius: '4px',
            marginBottom: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <AlertCircle size={12} />
            {enrichmentState.error}
          </div>
        )}

        {/* Results and Suggestions */}
        {enrichmentState.results && (
          <div style={{
            fontSize: '12px'
          }}>
            <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#8B0000' }}>Enrichment Suggestions:</div>
            
            {enrichmentState.results.description && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Description:</div>
                <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
                  {enrichmentState.results.description}
                </div>
                {!nodeData.description && (
                  <button
                    onClick={() => applySuggestion('description', enrichmentState.results.description)}
                    style={{
                      padding: '4px 8px',
                      fontSize: '10px',
                      backgroundColor: '#2E8B57',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '3px',
                      cursor: 'pointer'
                    }}
                  >
                    Apply Description
                  </button>
                )}
              </div>
            )}
            
            {enrichmentState.results.externalLinks.length > 0 && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>External Links:</div>
                {enrichmentState.results.externalLinks.map((link, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <code style={{ fontSize: '10px', padding: '2px 4px', borderRadius: '2px', background: 'rgba(0,0,0,0.05)' }}>
                      {link.substring(0, 50)}...
                    </code>
                    <button
                      onClick={() => applySuggestion('externalLink', link)}
                      style={{
                        padding: '2px 6px',
                        fontSize: '9px',
                        backgroundColor: '#2E8B57',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '2px',
                        cursor: 'pointer'
                      }}
                    >
                      Add
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            {enrichmentState.results.equivalentClasses.length > 0 && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Classifications:</div>
                {enrichmentState.results.equivalentClasses.map((cls, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '10px' }}>{cls.label}</span>
                    <span style={{ fontSize: '9px', color: '#666' }}>({cls.source})</span>
                    <button
                      onClick={() => applySuggestion('equivalentClass', cls)}
                      style={{
                        padding: '2px 6px',
                        fontSize: '9px',
                        backgroundColor: '#2E8B57',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '2px',
                        cursor: 'pointer'
                      }}
                    >
                      Add
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div style={{ fontSize: '10px', color: '#666', marginTop: '8px' }}>Confidence: {(enrichmentState.results.confidence * 100).toFixed(0)}%</div>
          </div>
        )}
      </div>

      {/* spacing only; avoid divider lines */}
      <div style={{ height: 12 }} />

      {/* Mass Import Progress */}
      {federationState.isImporting && (
        <div style={{
          marginBottom: '15px',
          padding: '12px',
          backgroundColor: '#EFE8E5',
          borderRadius: '6px',
          border: '1px solid #e0e0e0'
        }}>
          <div style={{ 
            fontSize: '12px', 
            color: '#4B0082',
            fontWeight: 'bold',
            marginBottom: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
            Mass Importing Knowledge Cluster...
          </div>
          <div style={{ fontSize: '11px', color: '#666' }}>
            Stage: {federationState.progress.stage}
            {federationState.progress.entity && ` | Entity: ${federationState.progress.entity}`}
            {federationState.progress.level > 0 && ` | Level: ${federationState.progress.level}`}
          </div>
        </div>
      )}

      {/* Mass Import Results */}
      {federationState.results && (
        <div style={{
          marginBottom: '15px',
          padding: '12px',
          backgroundColor: '#EFE8E5',
          borderRadius: '6px',
          border: '1px solid #e0e0e0'
        }}>
          <div style={{
            fontSize: '12px',
            color: '#4B0082',
            fontWeight: 'bold',
            marginBottom: '8px'
          }}>
            Knowledge Cluster Imported 🌐
          </div>
          <div style={{ fontSize: '11px', color: '#333', marginBottom: '6px' }}>
            <strong>{federationState.results.totalEntities}</strong> entities, <strong>{federationState.results.totalRelationships}</strong> relationships
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>
            Sources: {Object.entries(federationState.results.sourceBreakdown).map(([source, count]) => `${source}: ${count}`).join(', ')}
          </div>
          <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
            Clusters: {federationState.results.clusters.size}
          </div>
        </div>
      )}

      
      {/* Semantic Classification moved into Semantic Profile above */}

      {/* Resolved RDF Data Display */}
      {resolvedData.size > 0 && (
        <div style={{
          marginTop: '15px',
          padding: '12px',
          backgroundColor: '#EFE8E5',
          borderRadius: '6px',
          border: '1px solid #e0e0e0'
        }}>
          <h5 style={{
            margin: '0 0 10px 0',
            fontSize: '12px',
            color: '#8B0000',
            fontWeight: 'bold'
          }}>
            Resolved RDF Data ({resolvedData.size})
          </h5>
          {Array.from(resolvedData.entries()).map(([link, data], idx) => (
            <div key={idx} style={{
              marginBottom: '8px',
              padding: '6px',
              backgroundColor: '#bdb5b5',
              borderRadius: '4px',
              fontSize: '11px'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                {data.label || 'Unknown Resource'}
              </div>
              {data.description && (
                <div style={{ color: '#666', marginBottom: '4px' }}>
                  {data.description}
                </div>
              )}
              <div style={{ fontSize: '10px', color: '#8B0000' }}>Source: {link}</div>
            </div>
          ))}
        </div>
      )}

      {/* Hidden: Undo chips for "Applied from web"
      {autoApplied.length > 0 && (
        <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {autoApplied.slice(0,3).map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', borderRadius: '12px', background: 'rgba(139,0,0,0.1)', color: '#260000', fontSize: '10px' }}>
              Applied from web
              <button
                onClick={() => {
                  // basic undo: reapply prev where possible
                  const updates = { ...nodeData };
                  // for now only handle description/links revert
                  if (c.field === 'semanticWeb') {
                    // noop placeholder; future granular
                  }
                  onUpdate(updates);
                  setAutoApplied(prev => prev.filter((_, idx) => idx !== i));
                }}
                style={{ border: 'none', background: 'transparent', color: '#8B0000', cursor: 'pointer', fontWeight: 'bold' }}
              >
                Undo
              </button>
            </div>
          ))}
        </div>
      )}
      */}

      {/* Hidden: Advanced button moved to bottom
      <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            padding: '6px 12px',
            border: '1px solid #8B0000',
            borderRadius: '6px',
            background: 'transparent',
            color: '#8B0000',
            fontSize: '11px',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontFamily: "'EmOne', sans-serif"
          }}
        >
          {showAdvanced ? 'Advanced — On' : 'Advanced'}
        </button>
      </div>
      */}

      {/* Consolidate Preview Modal */}
      {showConsolidatePreview && consolidatePreview && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <div style={{
            backgroundColor: '#bdb5b5',
            padding: '20px',
            borderRadius: '8px',
            maxWidth: '600px',
            maxHeight: '80vh',
            overflow: 'auto',
            fontFamily: "'EmOne', sans-serif"
          }}>
            <h3 style={{ margin: '0 0 16px 0', color: '#260000' }}>Consolidate Preview</h3>
            
            <div style={{ marginBottom: '16px' }}>
              <h4 style={{ margin: '0 0 8px 0', color: '#260000', fontSize: '14px' }}>Changes to apply:</h4>
              
              {consolidatePreview.diff.description.changed && (
                <div style={{ marginBottom: '8px', padding: '8px', backgroundColor: 'rgba(220, 38, 38, 0.1)', borderRadius: '4px' }}>
                  <strong>Description:</strong><br/>
                  <span style={{ color: '#666', fontSize: '12px' }}>
                    Current: {consolidatePreview.diff.description.current || '(empty)'}
                  </span><br/>
                  <span style={{ color: '#059669', fontSize: '12px' }}>
                    New: {consolidatePreview.diff.description.incoming}
                  </span>
                </div>
              )}
              
              {consolidatePreview.diff.externalLinks.new.length > 0 && (
                <div style={{ marginBottom: '8px', padding: '8px', backgroundColor: 'rgba(5, 150, 105, 0.1)', borderRadius: '4px' }}>
                  <strong>New External Links ({consolidatePreview.diff.externalLinks.new.length}):</strong><br/>
                  {consolidatePreview.diff.externalLinks.new.slice(0, 3).map((link, i) => (
                    <div key={i} style={{ fontSize: '11px', color: '#666' }}>• {link}</div>
                  ))}
                  {consolidatePreview.diff.externalLinks.new.length > 3 && (
                    <div style={{ fontSize: '11px', color: '#666' }}>... and {consolidatePreview.diff.externalLinks.new.length - 3} more</div>
                  )}
                </div>
              )}
              
              {consolidatePreview.diff.equivalentClasses.new.length > 0 && (
                <div style={{ marginBottom: '8px', padding: '8px', backgroundColor: 'rgba(79, 70, 229, 0.1)', borderRadius: '4px' }}>
                  <strong>New Classifications ({consolidatePreview.diff.equivalentClasses.new.length}):</strong><br/>
                  {consolidatePreview.diff.equivalentClasses.new.slice(0, 3).map((cls, i) => (
                    <div key={i} style={{ fontSize: '11px', color: '#666' }}>• {cls['@id'] || cls.id || 'Unknown'}</div>
                  ))}
                  {consolidatePreview.diff.equivalentClasses.new.length > 3 && (
                    <div style={{ fontSize: '11px', color: '#666' }}>... and {consolidatePreview.diff.equivalentClasses.new.length - 3} more</div>
                  )}
                </div>
              )}
            </div>
            
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowConsolidatePreview(false)}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #666',
                  borderRadius: '4px',
                  backgroundColor: 'transparent',
                  color: '#666',
                  cursor: 'pointer',
                  fontFamily: "'EmOne', sans-serif"
                }}
              >
                Cancel
              </button>
              <button
                onClick={applyConsolidation}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #059669',
                  borderRadius: '4px',
                  backgroundColor: '#059669',
                  color: 'white',
                  cursor: 'pointer',
                  fontFamily: "'EmOne', sans-serif",
                  fontWeight: 'bold'
                }}
              >
                Apply Consolidation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SemanticEditor;