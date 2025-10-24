# RDF Resolution & SPARQL Integration

This document describes the new semantic web integration features added to Redstring, enabling real-time RDF data resolution and SPARQL querying capabilities.

## 🚀 Overview

The RDF Resolution & SPARQL Integration system transforms Redstring from having RDF vocabulary to actual semantic web connectivity. It provides:

- **URI Resolution**: Dereference external URIs to actual RDF data
- **SPARQL Integration**: Query external knowledge bases (Wikidata, DBpedia, Schema.org)
- **Semantic Enrichment**: AI-powered suggestions for external links and equivalent classes
- **RDF Validation**: Consistency checking across local and external data
- **Background Processing**: Automated resolution and enrichment workflows

## 🏗️ Architecture

### Core Services

#### 1. RDF Resolver (`src/services/rdfResolver.js`)
- HTTP content negotiation for RDF formats (Turtle, JSON-LD, RDF/XML, N-Triples)
- URI dereferencing with proper Accept headers
- Response format detection and parsing
- Caching layer with TTL-based expiration
- Error handling for unreachable/invalid URIs

#### 2. SPARQL Client (`src/services/sparqlClient.js`)
- Support for major endpoints (Wikidata, DBpedia, Schema.org)
- Query builder for common patterns (equivalentClass, sameAs, subClassOf)
- Result parsing and normalization
- Rate limiting and timeout handling
- Endpoint health checking and fallbacks

#### 3. Semantic Enrichment (`src/services/semanticEnrichment.js`)
- Background resolution worker with priority queuing
- Smart suggestion engine using NLP and entity extraction
- Conflict resolution for conflicting data sources
- Periodic re-resolution of cached data

#### 4. RDF Validation (`src/services/rdfValidation.js`)
- Consistency checking (circular inheritance, unique URIs)
- Ontology validation (class definitions, property constraints)
- Semantic validation (external link resolution, equivalent class consistency)
- Configurable validation rules and severity levels

### UI Components

#### RDF Resolution Panel (`src/components/RDFResolutionPanel.jsx`)
- Modal interface for resolving external links
- Display of resolved RDF triples in expandable sections
- Endpoint status monitoring
- Cache management and statistics
- Validation results display

#### Enhanced SemanticEditor
- Integration with RDF resolution services
- "Resolve Links" button for URI dereferencing
- "Get Suggestions" button for AI-powered recommendations
- "Validate" button for semantic consistency checking

## 🔧 Installation & Setup

### Dependencies

The following packages have been added to `package.json`:

```bash
npm install @rdfjs/parser-n3 @rdfjs/parser-jsonld sparql-http-client jsonld
```

### Configuration

No additional configuration is required. The services use sensible defaults:

- **RDF Resolver**: 24-hour cache TTL, 10-second timeout
- **SPARQL Client**: Rate limiting (500ms-1000ms between requests), 15-30 second timeouts
- **Semantic Enrichment**: 3 concurrent workers, 3 retry attempts
- **RDF Validation**: All rules enabled by default

## 📖 Usage

### Basic URI Resolution

```javascript
import { rdfResolver } from './src/services/rdfResolver.js';

// Resolve a URI to RDF data
const result = await rdfResolver.resolveURI('https://schema.org/Person');
console.log('Triples:', result.triples);
console.log('Content Type:', result.contentType);
```

### SPARQL Queries

```javascript
import { sparqlClient } from './src/services/sparqlClient.js';

// Find equivalent classes
const equivalents = await sparqlClient.findEquivalentClasses('wikidata', 'http://schema.org/Person');

// Search for entities
const results = await sparqlClient.searchEntities('wikidata', 'artificial intelligence', 'Class');
```

### Semantic Enrichment

```javascript
import { semanticEnrichment } from './src/services/semanticEnrichment.js';

// Get suggestions for external links
const suggestions = await semanticEnrichment.suggestExternalLinks(nodeId, nodeData);

// Resolve all external links for a node
const results = await semanticEnrichment.resolveNodeLinks(nodeId, externalLinks);
```

### RDF Validation

```javascript
import { rdfValidation } from './src/services/rdfValidation.js';

// Validate a complete graph
const results = await rdfValidation.validateGraph(graphData);

// Validate a specific node
const nodeResults = await rdfValidation.validateNode(nodeData, graphData);
```

## 🎯 User Experience

### Progressive Enhancement

The system works without network connectivity:
- Local validation rules still function
- Cached data remains available
- UI gracefully degrades for offline scenarios

### Clear Indicators

- **Resolved vs Unresolved**: Visual distinction between resolved and failed URI resolutions
- **Loading States**: Proper loading indicators during async operations
- **Error Handling**: User-friendly error messages with retry options
- **Confidence Scores**: Display confidence levels for AI-generated suggestions

### Async Operations

- **Background Processing**: Non-blocking resolution and enrichment
- **Progress Tracking**: Real-time updates on resolution progress
- **Cancellation**: Ability to cancel long-running operations
- **Retry Logic**: Automatic retry with exponential backoff

## 🔍 Testing

### Demo Script

Run the comprehensive demo to test all features:

```bash
node demo-rdf-resolution.js
```

### Unit Tests

```bash
npm test test/services/rdfResolver.test.js
npm test test/services/sparqlClient.test.js
npm test test/services/semanticEnrichment.test.js
npm test test/services/rdfValidation.test.js
```

### Integration Testing

The system includes integration tests that verify:
- End-to-end URI resolution workflows
- SPARQL endpoint connectivity
- Cache behavior and performance
- Error handling and recovery

## 🚦 Performance Considerations

### Caching Strategy

- **RDF Resolver**: 24-hour TTL for resolved URIs
- **SPARQL Client**: 1-hour TTL for query results
- **Memory Management**: Automatic cleanup of expired entries
- **Size Limits**: Configurable cache size limits

### Rate Limiting

- **Wikidata**: 1000ms between requests
- **DBpedia**: 500ms between requests
- **Schema.org**: 1000ms between requests
- **Custom endpoints**: Configurable rate limits

### Background Processing

- **Worker Pool**: Configurable number of concurrent workers
- **Queue Management**: Priority-based task scheduling
- **Resource Limits**: Memory and CPU usage monitoring
- **Graceful Degradation**: Fallback to synchronous operations when needed

## 🔒 Security & Privacy

### Network Security

- **HTTPS Only**: All external requests use secure connections
- **Timeout Protection**: Prevents hanging connections
- **Rate Limiting**: Prevents abuse of external services
- **User Agent**: Identifiable user agent for external services

### Data Privacy

- **Local Processing**: All RDF parsing happens locally
- **No Data Transmission**: Raw node data is not sent to external services
- **Cache Isolation**: Cache data is isolated to the local application
- **Configurable Privacy**: User control over what data is shared

## 🛠️ Troubleshooting

### Common Issues

#### URI Resolution Fails
- Check network connectivity
- Verify URI is accessible
- Check if URI returns valid RDF content
- Review browser console for CORS errors

#### SPARQL Queries Timeout
- Check endpoint status
- Verify query syntax
- Reduce query complexity
- Check rate limiting settings

#### Cache Issues
- Clear cache using the UI
- Check cache statistics
- Verify TTL settings
- Monitor memory usage

### Debug Mode

Enable debug logging:

```javascript
// In browser console
localStorage.setItem('debug', 'rdf:*');

// Or for specific services
localStorage.setItem('debug', 'rdf:resolver,sparql:client');
```

### Performance Monitoring

Monitor system performance:

```javascript
// Get cache statistics
const rdfStats = rdfResolver.getCacheStats();
const sparqlStats = sparqlClient.getCacheStats();

// Get service status
const validationStats = rdfValidation.getValidationStats();
const enrichmentStats = semanticEnrichment.getQueueStats();
```

## 🔮 Future Enhancements

### Phase 2: Advanced SPARQL Features
- Query builder interface
- Federated queries across multiple endpoints
- Result visualization and exploration
- Query optimization and caching

### Phase 3: Enhanced Enrichment
- NLP-based entity extraction
- Machine learning for suggestion quality
- Cross-language support
- Domain-specific enrichment rules

### Phase 4: Federation & Export
- Cross-endpoint data integration
- Comprehensive RDF export
- Multiple serialization formats
- Semantic validation reports

## 📚 API Reference

### RDF Resolver

```javascript
class RDFResolver {
  async resolveURI(uri, options) → Promise<Object>
  clearCache(uri?) → void
  getCacheStats() → Object
}
```

### SPARQL Client

```javascript
class SPARQLClient {
  async executeQuery(endpointKey, query, options) → Promise<Object>
  async findEquivalentClasses(endpointKey, classUri) → Promise<Array>
  async searchEntities(endpointKey, searchTerm, entityType?) → Promise<Array>
  async testEndpoint(endpointKey) → Promise<Object>
}
```

### Semantic Enrichment

```javascript
class SemanticEnrichment {
  async resolveNodeLinks(nodeId, externalLinks, options) → Promise<Object>
  async suggestExternalLinks(nodeId, nodeData) → Promise<Array>
  async suggestEquivalentClasses(nodeId, existingTypes) → Promise<Array>
  getQueueStats() → Object
}
```

### RDF Validation

```javascript
class RDFValidation {
  async validateGraph(graphData, options) → Promise<Object>
  async validateNode(nodeData, graphData, options) → Promise<Object>
  addValidationRule(ruleId, rule) → void
  generateReport(validationResults) → string
}
```

## 🤝 Contributing

### Development Setup

1. Install dependencies: `npm install`
2. Run tests: `npm test`
3. Start development server: `npm run dev`
4. Run demo: `node demo-rdf-resolution.js`

### Code Style

- Follow existing ESLint configuration
- Use JSDoc for all public methods
- Include unit tests for new features
- Follow the established error handling patterns

### Testing Guidelines

- Mock external dependencies in unit tests
- Include integration tests for real endpoints
- Test error conditions and edge cases
- Verify performance characteristics

## 📄 License

This implementation follows the same license as the main Redstring project.

---

**Note**: This is a significant enhancement to Redstring's semantic web capabilities. The system is designed to be robust, performant, and user-friendly while maintaining backward compatibility with existing functionality.
