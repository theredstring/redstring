/**
 * Semantic Web Query Service
 * 
 * Direct SPARQL queries and Wikipedia API integration 
 * for immediate semantic web data access
 */

/**
 * Simple Wikidata query for fast enrichment - just basic entity lookup
 * @param {string} entityName - Entity name to search for
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Wikidata results
 */
export async function simpleQueryWikidata(entityName, options = {}) {
  const { timeout = 15000, limit = 5 } = options;
  
  const query = `
    SELECT DISTINCT ?item ?itemLabel ?itemDescription WHERE {
      ?item rdfs:label "${entityName}"@en .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
    } LIMIT ${limit}
  `;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch('https://query.wikidata.org/sparql', {
      method: 'POST', 
      headers: {
        'Accept': 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Redstring-SemanticWeb/1.0'
      },
      body: `query=${encodeURIComponent(query)}`,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Wikidata HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.results && data.results.bindings) {
      return data.results.bindings.map(binding => ({
        item: binding.item,
        itemLabel: binding.itemLabel,
        itemDescription: binding.itemDescription
      }));
    }
    
    return [];

  } catch (error) {
    clearTimeout(timeoutId);
    console.warn('[SemanticWebQuery] Simple Wikidata query failed:', error);
    return [];
  }
}

/**
 * Simple DBpedia query for fast enrichment - just basic entity lookup
 * @param {string} entityName - Entity name to search for
 * @param {Object} options - Query options
 * @returns {Promise<Array>} DBpedia results
 */
export async function simpleQueryDBpedia(entityName, options = {}) {
  const { timeout = 15000, limit = 5 } = options;
  
  const query = `
    SELECT DISTINCT ?resource ?comment WHERE {
      ?resource rdfs:label "${entityName}"@en .
      OPTIONAL { ?resource rdfs:comment ?comment . FILTER(LANG(?comment) = "en") }
    } LIMIT ${limit}
  `;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch('https://dbpedia.org/sparql', {
      method: 'POST',
      headers: {
        'Accept': 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Redstring-SemanticWeb/1.0'
      },
      body: `query=${encodeURIComponent(query)}`,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`DBpedia HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.results && data.results.bindings) {
      return data.results.bindings.map(binding => ({
        resource: binding.resource,
        comment: binding.comment
      }));
    }
    
    return [];

  } catch (error) {
    clearTimeout(timeoutId);
    console.warn('[SemanticWebQuery] Simple DBpedia query failed:', error);
    return [];
  }
}

/**
 * Simple Wikipedia query for fast enrichment - just basic entity lookup
 * @param {string} entityName - Entity name to search for
 * @param {Object} options - Query options
 * @returns {Promise<Object|null>} Wikipedia result
 */
export async function simpleQueryWikipedia(entityName, options = {}) {
  const { timeout = 15000 } = options;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // First try direct page summary
    const summaryResponse = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(entityName)}`,
      { signal: controller.signal }
    );

    if (summaryResponse.ok) {
      const summaryData = await summaryResponse.json();
      clearTimeout(timeoutId);
      
      return {
        title: summaryData.title,
        description: summaryData.extract,
        url: summaryData.content_urls?.desktop?.page,
        thumbnail: summaryData.thumbnail?.source,
        source: 'wikipedia'
      };
    }

    // Fallback to search API
    const searchResponse = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/search?q=${encodeURIComponent(entityName)}&limit=1`,
      { signal: controller.signal }
    );

    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      if (searchData.pages && searchData.pages.length > 0) {
        const page = searchData.pages[0];
        clearTimeout(timeoutId);
        
        return {
          title: page.title,
          description: page.excerpt,
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
          thumbnail: page.thumbnail?.source,
          source: 'wikipedia'
        };
      }
    }

    clearTimeout(timeoutId);
    return null;

  } catch (error) {
    clearTimeout(timeoutId);
    console.warn('[SemanticWebQuery] Simple Wikipedia query failed:', error);
    return null;
  }
}

/**
 * Query Wikidata directly using fetch
 * @param {string} entityName - Entity name to search for
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Wikidata results
 */
export async function queryWikidata(entityName, options = {}) {
  const { timeout = 30000, limit = 10, searchType = 'fuzzy' } = options; // Increased default timeout to 30 seconds
  
  // Validate input to prevent malformed SPARQL queries
  if (!entityName || typeof entityName !== 'string' || entityName.trim() === '') {
    console.warn('[SemanticWebQuery] Invalid entityName for Wikidata query:', entityName);
    return [];
  }

  const sanitizedEntityName = entityName.trim();
  
  let query;
  if (searchType === 'exact') {
    // Exact label match
    query = `
      SELECT DISTINCT ?item ?itemLabel ?itemDescription WHERE {
        ?item rdfs:label "${sanitizedEntityName}"@en .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
      } LIMIT ${limit}
    `;
  } else {
    // Fuzzy search with broader matching
    query = `
      SELECT DISTINCT ?item ?itemLabel ?itemDescription ?itemAltLabel WHERE {
        {
          ?item rdfs:label "${sanitizedEntityName}"@en .
        } UNION {
          ?item skos:altLabel "${sanitizedEntityName}"@en .
        } UNION {
          ?item rdfs:label ?itemAltLabel .
          FILTER(CONTAINS(LCASE(?itemAltLabel), LCASE("${sanitizedEntityName}")))
        }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
      } LIMIT ${limit}
    `;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log(`[SemanticWebQuery] Wikidata query timeout after ${timeout}ms for "${sanitizedEntityName}"`);
    controller.abort();
  }, timeout);

  // Add a backup timeout that forces the promise to reject
  const backupTimeout = setTimeout(() => {
    console.log(`[SemanticWebQuery] Wikidata query backup timeout after ${timeout + 1000}ms for "${sanitizedEntityName}"`);
    // Force reject the promise if the controller.abort() didn't work
    throw new Error(`Wikidata query forced timeout after ${timeout + 1000}ms`);
  }, timeout + 1000);

  // Check if we have a global signal that might be aborted
  if (options.signal) {
    options.signal.addEventListener('abort', () => {
      console.log(`[SemanticWebQuery] Wikidata query aborted by global signal for "${sanitizedEntityName}"`);
      controller.abort();
      clearTimeout(backupTimeout);
    });
  }

  try {
    console.log(`[SemanticWebQuery] Starting Wikidata query for "${sanitizedEntityName}" with timeout: ${timeout}ms`);
    
    const response = await fetch('https://query.wikidata.org/sparql', {
      method: 'POST', 
      headers: {
        'Accept': 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Redstring-SemanticWeb/1.0'
      },
      body: `query=${encodeURIComponent(query)}`,
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    clearTimeout(backupTimeout);
    console.log(`[SemanticWebQuery] Wikidata query completed successfully for "${sanitizedEntityName}"`);

    if (!response.ok) {
      throw new Error(`Wikidata HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.results && data.results.bindings) {
      return data.results.bindings.map(binding => ({
        item: binding.item,
        itemLabel: binding.itemLabel,
        itemDescription: binding.itemDescription
      }));
    }
    
    return [];

  } catch (error) {
    clearTimeout(timeoutId);
    clearTimeout(backupTimeout);
    
    // Handle abort errors more gracefully
    if (error.name === 'AbortError') {
      console.warn(`[SemanticWebQuery] Wikidata query aborted for "${sanitizedEntityName}" (timeout: ${timeout}ms)`);
    } else {
      console.warn(`[SemanticWebQuery] Wikidata query failed for "${sanitizedEntityName}":`, error);
    }
    
    return [];
  }
}

/**
 * Query DBpedia directly using fetch
 * @param {string} entityName - Entity name to search for
 * @param {Object} options - Query options
 * @returns {Promise<Array>} DBpedia results
 */
export async function queryDBpedia(entityName, options = {}) {
  const { timeout = 30000, limit = 10, searchType = 'fuzzy', includeProperties = true } = options; // Increased default timeout to 30 seconds
  
  // Validate input to prevent malformed SPARQL queries
  if (!entityName || typeof entityName !== 'string' || entityName.trim() === '') {
    console.warn('[SemanticWebQuery] Invalid entityName for DBpedia query:', entityName);
    return [];
  }

  const sanitizedEntityName = entityName.trim();
  
  let query;
  if (searchType === 'exact') {
    // Exact label match with properties
    query = `
      SELECT DISTINCT ?resource ?comment ?label ?genre ?developer ?publisher ?platform ?series ?character ?gameplay ?engine WHERE {
        ?resource rdfs:label "${sanitizedEntityName}"@en .
        BIND("${sanitizedEntityName}" AS ?label)
        OPTIONAL { ?resource rdfs:comment ?comment . FILTER(LANG(?comment) = "en") }
        ${includeProperties ? `
        OPTIONAL { ?resource dbo:genre ?genre }
        OPTIONAL { ?resource dbo:developer ?developer }
        OPTIONAL { ?resource dbo:publisher ?publisher }
        OPTIONAL { ?resource dbo:platform ?platform }
        OPTIONAL { ?resource dbo:series ?series }
        OPTIONAL { ?resource dbo:character ?character }
        OPTIONAL { ?resource dbo:gameplay ?gameplay }
        OPTIONAL { ?resource dbo:engine ?engine }
        ` : ''}
      } LIMIT ${limit}
    `;
  } else {
    // Fuzzy search with broader matching and properties
    query = `
      SELECT DISTINCT ?resource ?comment ?label ?genre ?developer ?publisher ?platform ?series ?character ?gameplay ?engine WHERE {
        {
          ?resource rdfs:label "${sanitizedEntityName}"@en .
          BIND("${sanitizedEntityName}" AS ?label)
        } UNION {
          ?resource rdfs:label ?label .
          FILTER(CONTAINS(LCASE(?label), LCASE("${sanitizedEntityName}")))
        }
        OPTIONAL { ?resource rdfs:comment ?comment . FILTER(LANG(?comment) = "en") }
        ${includeProperties ? `
        OPTIONAL { ?resource dbo:genre ?genre }
        OPTIONAL { ?resource dbo:developer ?developer }
        OPTIONAL { ?resource dbo:publisher ?publisher }
        OPTIONAL { ?resource dbo:platform ?platform }
        OPTIONAL { ?resource dbo:series ?series }
        OPTIONAL { ?resource dbo:character ?character }
        OPTIONAL { ?resource dbo:gameplay ?gameplay }
        OPTIONAL { ?resource dbo:engine ?engine }
        ` : ''}
      } LIMIT ${limit}
    `;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log(`[SemanticWebQuery] DBpedia query timeout after ${timeout}ms for "${sanitizedEntityName}"`);
    controller.abort();
  }, timeout);

  // Add a backup timeout that forces the promise to reject
  const backupTimeout = setTimeout(() => {
    console.log(`[SemanticWebQuery] DBpedia query backup timeout after ${timeout + 1000}ms for "${sanitizedEntityName}"`);
    // Force reject the promise if the controller.abort() didn't work
    throw new Error(`DBpedia query forced timeout after ${timeout + 1000}ms`);
  }, timeout + 1000);

  // Check if we have a global signal that might be aborted
  if (options.signal) {
    options.signal.addEventListener('abort', () => {
      console.log(`[SemanticWebQuery] DBpedia query aborted by global signal for "${sanitizedEntityName}"`);
      controller.abort();
      clearTimeout(backupTimeout);
    });
  }

  try {
    console.log(`[SemanticWebQuery] Starting DBpedia query for "${sanitizedEntityName}" with timeout: ${timeout}ms`);
    
    const response = await fetch('https://dbpedia.org/sparql', {
      method: 'POST',
      headers: {
        'Accept': 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Redstring-SemanticWeb/1.0'
      },
      body: `query=${encodeURIComponent(query)}`,
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    clearTimeout(backupTimeout);
    console.log(`[SemanticWebQuery] DBpedia query completed successfully for "${sanitizedEntityName}"`);

    if (!response.ok) {
      throw new Error(`DBpedia HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.results && data.results.bindings) {
      return data.results.bindings.map(binding => ({
        resource: binding.resource,
        comment: binding.comment,
        label: binding.label,
        genre: binding.genre,
        developer: binding.developer,
        publisher: binding.publisher,
        platform: binding.platform,
        series: binding.series,
        character: binding.character,
        gameplay: binding.gameplay,
        engine: binding.engine
      }));
    }
    
    return [];

  } catch (error) {
    clearTimeout(timeoutId);
    clearTimeout(backupTimeout);
    
    // Handle abort errors more gracefully
    if (error.name === 'AbortError') {
      console.warn(`[SemanticWebQuery] DBpedia query aborted for "${sanitizedEntityName}" (timeout: ${timeout}ms)`);
    } else {
      console.warn(`[SemanticWebQuery] DBpedia query failed for "${sanitizedEntityName}":`, error);
    }
    
    return [];
  }
}

/**
 * Query Wikipedia API for basic entity info
 * @param {string} entityName - Entity name to search for
 * @param {Object} options - Query options
 * @returns {Promise<Object|null>} Wikipedia result
 */
export async function queryWikipedia(entityName, options = {}) {
  const { timeout = 20000 } = options; // Increased default timeout to 20 seconds
  
  // Validate input to prevent malformed API calls
  if (!entityName || typeof entityName !== 'string' || entityName.trim() === '') {
    console.warn('[SemanticWebQuery] Invalid entityName for Wikipedia query:', entityName);
    return null;
  }

  const sanitizedEntityName = entityName.trim();
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log(`[SemanticWebQuery] Wikipedia query timeout after ${timeout}ms for "${sanitizedEntityName}"`);
    controller.abort();
  }, timeout);

  // Add a backup timeout that forces the promise to reject
  const backupTimeout = setTimeout(() => {
    console.log(`[SemanticWebQuery] Wikipedia query backup timeout after ${timeout + 1000}ms for "${sanitizedEntityName}"`);
    // Force reject the promise if the controller.abort() didn't work
    throw new Error(`Wikipedia query forced timeout after ${timeout + 1000}ms`);
  }, timeout + 1000);

  // Check if we have a global signal that might be aborted
  if (options.signal) {
    options.signal.addEventListener('abort', () => {
      console.log(`[SemanticWebQuery] Wikipedia query aborted by global signal for "${sanitizedEntityName}"`);
      controller.abort();
      clearTimeout(backupTimeout);
    });
  }

  try {
    console.log(`[SemanticWebQuery] Starting Wikipedia query for "${sanitizedEntityName}" with timeout: ${timeout}ms`);
    
    // First try direct page summary
    const summaryResponse = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(sanitizedEntityName)}`,
      { signal: controller.signal }
    );

    if (summaryResponse.ok) {
      const summaryData = await summaryResponse.json();
      clearTimeout(timeoutId);
      clearTimeout(backupTimeout);
      console.log(`[SemanticWebQuery] Wikipedia query completed successfully for "${sanitizedEntityName}"`);
      
      return {
        title: summaryData.title,
        description: summaryData.extract,
        url: summaryData.content_urls?.desktop?.page,
        thumbnail: summaryData.thumbnail?.source,
        source: 'wikipedia'
      };
    }

    // Fallback to search API
    const searchResponse = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/search?q=${encodeURIComponent(sanitizedEntityName)}&limit=1`,
      { signal: controller.signal }
    );

    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      if (searchData.pages && searchData.pages.length > 0) {
        const page = searchData.pages[0];
        clearTimeout(timeoutId);
        clearTimeout(backupTimeout);
        console.log(`[SemanticWebQuery] Wikipedia query completed successfully for "${sanitizedEntityName}" (via search)`);
        
        return {
          title: page.title,
          description: page.excerpt,
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
          thumbnail: page.thumbnail?.source,
          source: 'wikipedia'
        };
      }
    }

    clearTimeout(timeoutId);
    clearTimeout(backupTimeout);
    console.log(`[SemanticWebQuery] Wikipedia query completed with no results for "${sanitizedEntityName}"`);
    return null;

  } catch (error) {
    clearTimeout(timeoutId);
    clearTimeout(backupTimeout);
    
    // Handle abort errors more gracefully
    if (error.name === 'AbortError') {
      console.warn(`[SemanticWebQuery] Wikipedia query aborted for "${sanitizedEntityName}" (timeout: ${timeout}ms)`);
    } else {
      console.warn(`[SemanticWebQuery] Wikipedia query failed for "${sanitizedEntityName}":`, error);
    }
    
    return null;
  }
}

/**
 * Fast semantic web enrichment - optimized for speed and simplicity
 * This is the original fast version that just finds the main entity
 * @param {string} entityName - Entity name to enrich
 * @param {Object} options - Enrichment options
 * @returns {Promise<Object>} Enrichment results
 */
export async function fastEnrichFromSemanticWeb(entityName, options = {}) {
  const { timeout = 15000 } = options;
  
  // Validate input to prevent malformed queries
  if (!entityName || typeof entityName !== 'string' || entityName.trim() === '') {
    console.warn('[SemanticWebQuery] Invalid entityName for fast enrichment:', entityName);
    return {
      entityName: entityName,
      sources: {},
      suggestions: {
        externalLinks: [],
        description: null,
        equivalentClasses: [],
        confidence: 0
      },
      timestamp: new Date().toISOString(),
      error: 'Invalid entity name provided'
    };
  }

  const sanitizedEntityName = entityName.trim();
  
  const results = {
    entityName: sanitizedEntityName,
    sources: {},
    suggestions: {
      externalLinks: [],
      description: null,
      equivalentClasses: [],
      confidence: 0
    },
    timestamp: new Date().toISOString()
  };

  try {
    console.log(`[SemanticWebQuery] Starting fast enrichment for "${sanitizedEntityName}" with timeout: ${timeout}ms`);
    
    // Query all sources in parallel with simple timeouts
    const [wikidataResults, dbpediaResults, wikipediaResult] = await Promise.allSettled([
      simpleQueryWikidata(sanitizedEntityName, { timeout }),
      simpleQueryDBpedia(sanitizedEntityName, { timeout }), 
      simpleQueryWikipedia(sanitizedEntityName, { timeout })
    ]);

    console.log(`[SemanticWebQuery] Fast enrichment results for "${sanitizedEntityName}":`, {
      wikidata: wikidataResults.status,
      dbpedia: dbpediaResults.status,
      wikipedia: wikipediaResult.status
    });

    // Process results with Wikipedia prioritization
    // First, collect all sources without applying any data
    const sourceData = {
      wikidata: null,
      dbpedia: null,
      wikipedia: null
    };

    // Process Wikidata results
    if (wikidataResults.status === 'fulfilled' && wikidataResults.value.length > 0) {
      const wdResult = wikidataResults.value[0];
      results.sources.wikidata = {
        found: true,
        results: wikidataResults.value
      };
      sourceData.wikidata = {
        externalLink: wdResult.item?.value,
        description: wdResult.itemDescription?.value,
        confidence: 0.9
      };
    } else {
      results.sources.wikidata = {
        found: false,
        error: wikidataResults.reason?.message
      };
    }

    // Process DBpedia results
    if (dbpediaResults.status === 'fulfilled' && dbpediaResults.value.length > 0) {
      const dbResult = dbpediaResults.value[0];
      results.sources.dbpedia = {
        found: true,
        results: dbpediaResults.value
      };
      sourceData.dbpedia = {
        externalLink: dbResult.resource?.value,
        description: dbResult.comment?.value,
        confidence: 0.8
      };
    } else {
      results.sources.dbpedia = {
        found: false,
        error: dbpediaResults.reason?.message
      };
    }

    // Process Wikipedia results
    if (wikipediaResult.status === 'fulfilled' && wikipediaResult.value) {
      const wpResult = wikipediaResult.value;
      results.sources.wikipedia = {
        found: true,
        result: wpResult
      };
      sourceData.wikipedia = {
        externalLink: wpResult.url,
        description: wpResult.description,
        confidence: 0.95 // Highest confidence for Wikipedia definitions
      };
    } else {
      results.sources.wikipedia = {
        found: false,
        error: wikipediaResult.reason?.message
      };
    }

    // Apply results with Wikipedia-first prioritization
    // Priority order: Wikipedia > DBpedia > Wikidata
    const sources = ['wikipedia', 'dbpedia', 'wikidata'];
    
    for (const sourceName of sources) {
      const data = sourceData[sourceName];
      if (!data) continue;
      
      // Add external links (all sources)
      if (data.externalLink) {
        results.suggestions.externalLinks.push(data.externalLink);
      }
      
      // Set description only if we don't have one yet (Wikipedia gets first chance)
      if (data.description && !results.suggestions.description) {
        results.suggestions.description = data.description;
        results.suggestions.confidence = Math.max(results.suggestions.confidence, data.confidence);
        console.log(`[SemanticWebQuery] Using ${sourceName} description for "${sanitizedEntityName}": "${data.description.substring(0, 100)}..."`);
      }
    }

    // Remove duplicates from external links
    results.suggestions.externalLinks = [...new Set(results.suggestions.externalLinks)];

    console.log(`[SemanticWebQuery] Fast enriched "${entityName}" with ${results.suggestions.externalLinks.length} links, confidence: ${results.suggestions.confidence}`);
    
    return results;

  } catch (error) {
    console.error('[SemanticWebQuery] Fast enrichment failed:', error);
    return {
      entityName: entityName,
      sources: {},
      suggestions: { externalLinks: [], description: null, equivalentClasses: [], confidence: 0 },
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Comprehensive semantic web enrichment
 * @param {string} entityName - Entity name to enrich
 * @param {Object} options - Enrichment options
 * @returns {Promise<Object>} Enrichment results
 */
export async function enrichFromSemanticWeb(entityName, options = {}) {
  // Validate input to prevent malformed queries
  if (!entityName || typeof entityName !== 'string' || entityName.trim() === '') {
    console.warn('[SemanticWebQuery] Invalid entityName for semantic web enrichment:', entityName);
    return {
      entityName: entityName,
      sources: {},
      suggestions: {
        externalLinks: [],
        description: null,
        equivalentClasses: [],
        confidence: 0
      },
      timestamp: new Date().toISOString(),
      error: 'Invalid entity name provided'
    };
  }

  const sanitizedEntityName = entityName.trim();
  
  const results = {
    entityName: sanitizedEntityName,
    sources: {},
    suggestions: {
      externalLinks: [],
      description: null,
      equivalentClasses: [],
      confidence: 0
    },
    timestamp: new Date().toISOString()
  };

  try {
    // Query all sources in parallel with individual timeouts
    console.log(`[SemanticWebQuery] Starting enrichment for "${sanitizedEntityName}" with timeout: ${options.timeout || 'default'}ms`);
    
    // Use individual timeouts instead of global timeout for better control
    const individualTimeout = Math.max(options.timeout || 20000, 15000);
    
    console.log(`[SemanticWebQuery] Enrichment timeout details for "${sanitizedEntityName}":`, {
      individualTimeout,
      actualTimeout: individualTimeout
    });
    
    // Start all queries with individual timeouts
    const wikidataPromise = queryWikidata(sanitizedEntityName, { 
      ...options, 
      timeout: individualTimeout
    }).catch(error => {
      console.warn(`[SemanticWebQuery] Wikidata query failed:`, error);
      return [];
    });
    
    const dbpediaPromise = queryDBpedia(sanitizedEntityName, { 
      ...options, 
      timeout: individualTimeout
    }).catch(error => {
      console.warn(`[SemanticWebQuery] DBpedia query failed:`, error);
      return [];
    });
    
    const wikipediaPromise = queryWikipedia(sanitizedEntityName, { 
      ...options, 
      timeout: individualTimeout
    }).catch(error => {
      console.warn(`[SemanticWebQuery] Wikipedia query failed:`, error);
      return null;
    });
    
    // Wait for all queries with a reasonable timeout
    const [wikidataResults, dbpediaResults, wikipediaResult] = await Promise.allSettled([
      wikidataPromise,
      dbpediaPromise,
      wikipediaPromise
    ]);
    
    console.log(`[SemanticWebQuery] Enrichment results for "${sanitizedEntityName}":`, {
      wikidata: wikidataResults.status,
      dbpedia: dbpediaResults.status,
      wikipedia: wikipediaResult.status
    });

    // Process results with Wikipedia prioritization
    // First, collect all sources without applying any data
    const sourceData = {
      wikidata: null,
      dbpedia: null,
      wikipedia: null
    };

    // Process Wikidata results
    if (wikidataResults.status === 'fulfilled' && wikidataResults.value.length > 0) {
      const wdResult = wikidataResults.value[0];
      results.sources.wikidata = {
        found: true,
        results: wikidataResults.value
      };
      sourceData.wikidata = {
        externalLink: wdResult.item?.value,
        description: wdResult.itemDescription?.value,
        confidence: 0.9
      };
    } else {
      results.sources.wikidata = {
        found: false,
        error: wikidataResults.reason?.message
      };
    }

    // Process DBpedia results
    if (dbpediaResults.status === 'fulfilled' && dbpediaResults.value.length > 0) {
      const dbResult = dbpediaResults.value[0];
      results.sources.dbpedia = {
        found: true,
        results: dbpediaResults.value
      };
      sourceData.dbpedia = {
        externalLink: dbResult.resource?.value,
        description: dbResult.comment?.value,
        confidence: 0.8
      };
    } else {
      results.sources.dbpedia = {
        found: false,
        error: dbpediaResults.reason?.message
      };
    }

    // Process Wikipedia results
    if (wikipediaResult.status === 'fulfilled' && wikipediaResult.value) {
      const wpResult = wikipediaResult.value;
      results.sources.wikipedia = {
        found: true,
        result: wpResult
      };
      sourceData.wikipedia = {
        externalLink: wpResult.url,
        description: wpResult.description,
        confidence: 0.95 // Highest confidence for Wikipedia definitions
      };
    } else {
      results.sources.wikipedia = {
        found: false,
        error: wikipediaResult.reason?.message
      };
    }

    // Apply results with Wikipedia-first prioritization
    // Priority order: Wikipedia > DBpedia > Wikidata
    const sources = ['wikipedia', 'dbpedia', 'wikidata'];
    
    for (const sourceName of sources) {
      const data = sourceData[sourceName];
      if (!data) continue;
      
      // Add external links (all sources)
      if (data.externalLink) {
        results.suggestions.externalLinks.push(data.externalLink);
      }
      
      // Set description only if we don't have one yet (Wikipedia gets first chance)
      if (data.description && !results.suggestions.description) {
        results.suggestions.description = data.description;
        results.suggestions.confidence = Math.max(results.suggestions.confidence, data.confidence);
        console.log(`[SemanticWebQuery] Using ${sourceName} description for "${sanitizedEntityName}": "${data.description.substring(0, 100)}..."`);
      }
    }

    // Remove duplicates from external links
    results.suggestions.externalLinks = [...new Set(results.suggestions.externalLinks)];

    console.log(`[SemanticWebQuery] Enriched "${entityName}" with ${results.suggestions.externalLinks.length} links, confidence: ${results.suggestions.confidence}`);
    
    return results;
    
  } catch (error) {
    console.error('[SemanticWebQuery] Enrichment failed:', error);
    return {
      entityName: entityName,
      sources: {},
      suggestions: {
        externalLinks: [],
        description: null,
        equivalentClasses: [],
        confidence: 0
      },
      timestamp: new Date().toISOString(),
      error: error.message
    };
  }
}

/**
 * Find semantically related concepts using broader search strategies
 * @param {string} entityName - Entity name to search for
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Related concepts
 */
export async function findRelatedConcepts(entityName, options = {}) {
  const { timeout = 15000, limit = 15, includeCategories = true } = options;
  
  try {
    // 1. Direct entity search
    const directResults = await Promise.allSettled([
      queryWikidata(entityName, { ...options, searchType: 'fuzzy' }),
      queryDBpedia(entityName, { ...options, searchType: 'fuzzy' })
    ]);
    
    const results = [];
    
    // Process Wikidata results
    if (directResults[0].status === 'fulfilled') {
      results.push(...directResults[0].value.map(item => ({
        ...item,
        source: 'wikidata',
        type: 'direct'
      })));
    }
    
    // Process DBpedia results
    if (directResults[1].status === 'fulfilled') {
      results.push(...directResults[1].value.map(item => ({
        ...item,
        source: 'dbpedia',
        type: 'direct'
      })));
    }
    
    // 2. Category-based search for broader concepts
    if (includeCategories) {
      const categoryResults = await findCategoryConcepts(entityName, { timeout, limit: 10 });
      results.push(...categoryResults.map(item => ({
        ...item,
        source: 'category',
        type: 'related'
      })));
    }
    
    // 3. DBpedia property-based search for semantic relationships
    try {
      const propertyResults = await findRelatedThroughDBpediaProperties(entityName, { 
        timeout, 
        limit: 15
      });
      
      results.push(...propertyResults.map(item => ({
        ...item,
        source: 'dbpedia_properties',
        type: 'property_related',
        connectionInfo: {
          type: item.connectionType,
          value: item.connectionValue
        }
      })));
    } catch (error) {
      console.warn('[SemanticWebQuery] Property-based search failed:', error);
    }
    
    // 4. Consolidate SameAs relationships and remove duplicates
    const consolidatedResults = consolidateSameAsResults(results);
    
    // 5. Remove remaining duplicates and limit results
    const uniqueResults = consolidatedResults.filter((item, index, self) => 
      index === self.findIndex(t => 
        (t.itemLabel?.value || t.label?.value) === (item.itemLabel?.value || item.label?.value)
      )
    );
    
    return uniqueResults.slice(0, limit);
    
  } catch (error) {
    console.warn('[SemanticWebQuery] Related concepts search failed:', error);
    return [];
  }
}

/**
 * Consolidate results that represent the same entity across different sources
 * @param {Array} results - Array of search results
 * @returns {Array} Consolidated results
 */
function consolidateSameAsResults(results) {
  const consolidated = [];
  const processed = new Set();
  
  for (const result of results) {
    const key = result.itemLabel?.value || result.label?.value || result.name;
    if (!key || processed.has(key)) continue;
    
    // Find all results that represent the same entity
    const sameEntity = results.filter(r => {
      const rKey = r.itemLabel?.value || r.label?.value || r.name;
      return rKey === key;
    });
    
    if (sameEntity.length > 1) {
      // Consolidate into one result with combined sources
      const consolidatedResult = {
        ...sameEntity[0],
        source: 'multiple',
        sources: sameEntity.map(r => r.source),
        type: 'consolidated'
      };
      
      consolidated.push(consolidatedResult);
      processed.add(key);
    } else {
      consolidated.push(result);
      processed.add(key);
    }
  }
  
  return consolidated;
}

/**
 * Find concepts in related categories
 * @param {string} entityName - Entity name to search for
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Category concepts
 */
async function findCategoryConcepts(entityName, options = {}) {
  const { timeout = 15000, limit = 10 } = options;
  
  // Define common categories that might be related
  const relatedCategories = {
    'game': ['video game', 'game', 'gaming', 'playstation', 'xbox', 'nintendo', 'pc game'],
    'technology': ['technology', 'software', 'hardware', 'digital', 'electronic', 'computer'],
    'media': ['media', 'entertainment', 'video', 'audio', 'film', 'television'],
    'company': ['company', 'corporation', 'business', 'developer', 'publisher', 'studio'],
    'platform': ['platform', 'console', 'system', 'device', 'hardware']
  };
  
  const results = [];
  
  // Find which categories the entity might belong to
  const entityLower = entityName.toLowerCase();
  const relevantCategories = [];
  
  for (const [category, keywords] of Object.entries(relatedCategories)) {
    if (keywords.some(keyword => entityLower.includes(keyword))) {
      relevantCategories.push(category);
    }
  }
  
  // If no specific category found, try general search
  if (relevantCategories.length === 0) {
    relevantCategories.push('general');
  }
  
  // Search for concepts in relevant categories
  for (const category of relevantCategories.slice(0, 3)) {
    try {
      const categoryQuery = `
        SELECT DISTINCT ?item ?itemLabel ?itemDescription WHERE {
          ?item wdt:P31 ?type .
          ?type rdfs:label ?typeLabel .
          FILTER(CONTAINS(LCASE(?typeLabel), "${category}"))
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
        } LIMIT 5
      `;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      try {
        const response = await fetch('https://query.wikidata.org/sparql', {
          method: 'POST',
          headers: {
            'Accept': 'application/sparql-results+json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Redstring-SemanticWeb/1.0'
          },
          body: `query=${encodeURIComponent(categoryQuery)}`,
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const data = await response.json();
          if (data.results?.bindings) {
            results.push(...data.results.bindings);
          }
        }
      } catch (error) {
        clearTimeout(timeoutId);
        console.warn(`[SemanticWebQuery] Category search failed for ${category}:`, error);
      }
    } catch (error) {
      console.warn(`[SemanticWebQuery] Failed to process category ${category}:`, error);
    }
  }
  
  return results.slice(0, limit);
}

/**
 * Discover all properties for a DBpedia entity
 * @param {string} entityName - Entity name to discover properties for
 * @param {Object} options - Discovery options
 * @returns {Promise<Array>} Array of properties
 */
export async function discoverDBpediaProperties(entityName, options = {}) {
  const { timeout = 10000, limit = 100, specificProperties = false } = options;

  if (!entityName || typeof entityName !== 'string' || entityName.trim() === '') {
    console.warn('[SemanticWebQuery] Invalid entityName for DBpedia properties:', entityName);
    return [];
  }

  const sanitizedEntityName = entityName.trim();
  const resourceUri = `http://dbpedia.org/resource/${sanitizedEntityName.replace(/\s+/g, '_')}`;

  const query = `
    SELECT DISTINCT ?property ?value ?valueLabel WHERE {
      <${resourceUri}> ?property ?value .
      OPTIONAL { ?value rdfs:label ?valueLabel . FILTER(LANG(?valueLabel) = "en") }
    } LIMIT ${limit}
  `;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch('https://dbpedia.org/sparql', {
      method: 'POST',
      headers: {
        'Accept': 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Redstring-SemanticWeb/1.0'
      },
      body: `query=${encodeURIComponent(query)}`,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return [];
    }

    const data = await response.json();

    if (data.results?.bindings) {
      return data.results.bindings.map(binding => ({
        property: binding.property?.value,
        value: binding.value?.value,
        valueLabel: binding.valueLabel?.value
      }));
    }

    return [];

  } catch (error) {
    console.warn('[SemanticWebQuery] DBpedia properties discovery failed:', error);
    return [];
  }
}

/**
 * Find related entities through DBpedia properties
 * @param {string} entityName - Entity name to search for
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Related entities through properties
 */
export async function findRelatedThroughDBpediaProperties(entityName, options = {}) {
  const { timeout = 15000, limit = 20 } = options;

  // Validate input to prevent malformed queries
  if (!entityName || typeof entityName !== 'string' || entityName.trim() === '') {
    console.warn('[SemanticWebQuery] Invalid entityName for property-based search:', entityName);
    return [];
  }

  const sanitizedEntityName = entityName.trim();

  try {
    // Get all available properties for the entity
    const allProperties = await discoverDBpediaProperties(sanitizedEntityName, {
      limit: 100,
      specificProperties: false
    });
    
    if (!allProperties || allProperties.length === 0) {
      return [];
    }
    
    const results = [];
    
    // Look for wikiPageWikiLink properties that create entity relationships
    for (const prop of allProperties) {
      if (!prop.value) {
        continue;
      }
      
      const valueUri = prop.value;
      const propertyUri = prop.property;
      
      // Focus on wikiPageWikiLink properties that create entity relationships
      if (propertyUri === 'http://dbpedia.org/ontology/wikiPageWikiLink' && 
          valueUri.includes('dbpedia.org/resource/')) {
        
        // Find other entities that also link to this same entity
        const relatedQuery = `
          SELECT DISTINCT ?resource ?resourceLabel ?comment WHERE {
            ?resource <http://dbpedia.org/ontology/wikiPageWikiLink> <${valueUri}> .
            ?resource rdfs:label ?resourceLabel . FILTER(LANG(?resourceLabel) = "en")
            OPTIONAL { ?resource rdfs:comment ?comment . FILTER(LANG(?comment) = "en") }
            FILTER(?resource != <http://dbpedia.org/resource/${sanitizedEntityName.replace(/\s+/g, '_')}>)
          } LIMIT 5
        `;
        
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);
          
          const response = await fetch('https://dbpedia.org/sparql', {
            method: 'POST',
            headers: {
              'Accept': 'application/sparql-results+json',
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'Redstring-SemanticWeb/1.0'
            },
            body: `query=${encodeURIComponent(relatedQuery)}`,
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (response.ok) {
            const data = await response.json();
            if (data.results?.bindings) {
              results.push(...data.results.bindings.map(item => ({
                ...item,
                connectionType: 'related_via',
                connectionValue: prop.valueLabel || prop.value?.split('/').pop() || 'Unknown',
                originalEntity: prop.valueLabel || prop.value?.split('/').pop() || 'Unknown'
              })));
            }
          }
        } catch (error) {
          console.warn(`[SemanticWebQuery] Related entity search failed for ${valueUri}:`, error);
        }
      }
    }
    
    // Remove duplicates and limit results
    const uniqueResults = results.filter((item, index, self) => 
      index === self.findIndex(t => t.resource?.value === item.resource?.value)
    );
    
    return uniqueResults.slice(0, limit);
    
  } catch (error) {
    console.warn('[SemanticWebQuery] DBpedia property-based search failed:', error);
    return [];
  }
}

/**
 * Comprehensive search that explores all DBpedia relationships for an entity
 * @param {string} entityName - Entity name to search for
 * @param {Object} options - Search options
 * @returns {Promise<Object>} Comprehensive search results
 */
export async function comprehensiveDBpediaSearch(entityName, options = {}) {
  const { timeout = 15000, limit = 50 } = options;
  
  // Validate input to prevent malformed queries
  if (!entityName || typeof entityName !== 'string' || entityName.trim() === '') {
    console.warn('[ComprehensiveSearch] Invalid entityName for DBpedia search:', entityName);
    return { mainEntity: null, relatedEntities: [], properties: [], categories: [], externalLinks: [] };
  }

  const sanitizedEntityName = entityName.trim();
  
  try {
    // 1. Get the main entity and all its properties
    const mainEntity = await queryDBpedia(sanitizedEntityName, { 
      searchType: 'exact', 
      includeProperties: true, 
      limit: 1 
    });
    
    if (!mainEntity || mainEntity.length === 0) {
      return { mainEntity: null, relatedEntities: [], properties: [], categories: [], externalLinks: [] };
    }
    
    const entity = mainEntity[0];
    const results = {
      mainEntity: entity,
      relatedEntities: [],
      properties: [],
      categories: [],
      externalLinks: []
    };
    
    // 2. Get all properties for categorization
    const allProperties = await discoverDBpediaProperties(sanitizedEntityName, { 
      limit: 200, 
      specificProperties: false 
    });
    
    // 3. Categorize properties
    for (const prop of allProperties) {
      if (!prop.value) continue;
      
      const propertyUri = prop.property;
      const valueUri = prop.value;
      
      if (propertyUri.includes('wikiPageWikiLink')) {
        // This creates relationships to other entities
        results.properties.push({
          type: 'relationship',
          property: prop.propertyLabel || prop.property?.split('/').pop(),
          value: prop.valueLabel || prop.value?.split('/').pop(),
          uri: valueUri
        });
      } else if (propertyUri.includes('genre') || propertyUri.includes('type') || propertyUri.includes('category')) {
        // Categorical properties
        results.categories.push({
          type: 'category',
          property: prop.propertyLabel || prop.property?.split('/').pop(),
          value: prop.valueLabel || prop.value?.split('/').pop()
        });
      } else if (propertyUri.includes('external') || propertyUri.includes('url') || propertyUri.includes('link')) {
        // External links
        results.externalLinks.push({
          type: 'external',
          property: prop.propertyLabel || prop.property?.split('/').pop(),
          value: prop.valueLabel || prop.value?.split('/').pop(),
          uri: valueUri
        });
      } else {
        // Other properties
        results.properties.push({
          type: 'attribute',
          property: prop.propertyLabel || prop.property?.split('/').pop(),
          value: prop.valueLabel || prop.value?.split('/').pop()
        });
      }
    }
    
    // 4. Find related entities through wikiPageWikiLink relationships
    const relatedEntities = await findRelatedThroughDBpediaProperties(sanitizedEntityName, { timeout, limit: 30 });
    results.relatedEntities = relatedEntities;
    
    // 5. Find entities in the same categories
    const categoryEntities = await findEntitiesInSameCategories(sanitizedEntityName, results.categories, { timeout, limit: 20 });
    results.relatedEntities.push(...categoryEntities);
    
    return results;
    
  } catch (error) {
    console.warn('[SemanticWebQuery] Comprehensive DBpedia search failed:', error);
    return { mainEntity: null, relatedEntities: [], properties: [], categories: [], externalLinks: [] };
  }
}

/**
 * Safely extract text value from SPARQL result object
 * @param {Object} sparqlValue - SPARQL result value object
 * @param {string} fallback - Fallback text if extraction fails
 * @returns {string} Extracted text value
 */
function safeExtractText(sparqlValue, fallback = 'Unknown') {
  if (!sparqlValue) return fallback;
  if (typeof sparqlValue === 'string') return sparqlValue;
  if (typeof sparqlValue === 'object' && sparqlValue.value) {
    return typeof sparqlValue.value === 'string' ? sparqlValue.value : fallback;
  }
  return fallback;
}

/**
 * Enhanced semantic search that integrates multiple sources and provides rich results
 * This function is designed to be used by the semantic discovery interface
 * @param {string} entityName - Entity name to search for
 * @param {Object} options - Search options
 * @returns {Promise<Object>} Enhanced search results in a format compatible with semantic discovery
 */
export async function enhancedSemanticSearch(entityName, options = {}) {
  const { timeout = 45000, limit = 50, includeWikipedia = true } = options;
  
  // Validate input to prevent malformed queries
  if (!entityName || typeof entityName !== 'string' || entityName.trim() === '') {
    console.warn('[EnhancedSearch] Invalid entityName for semantic search:', entityName);
    return {
      entities: new Map(),
      relationships: [],
      metadata: {
        searchTerm: entityName,
        sources: [],
        totalEntities: 0,
        totalRelationships: 0,
        searchTime: new Date().toISOString(),
        error: 'Invalid entity name provided'
      }
    };
  }

  const sanitizedEntityName = entityName.trim();
  
  try {
    const results = {
      entities: new Map(),
      relationships: [],
      metadata: {
        searchTerm: sanitizedEntityName,
        sources: ['dbpedia', 'wikidata', 'wikipedia'],
        totalEntities: 0,
        totalRelationships: 0,
        searchTime: new Date().toISOString()
      }
    };
    
    // 1. Start with comprehensive DBpedia search (most reliable)
    console.log(`[EnhancedSearch] Starting comprehensive DBpedia search for "${sanitizedEntityName}"`);
    const dbpediaResults = await comprehensiveDBpediaSearch(sanitizedEntityName, { timeout: timeout * 0.7, limit: Math.floor(limit * 0.7) });
    
    if (dbpediaResults.mainEntity) {
      // Add main entity
      const mainEntityId = `dbpedia-${sanitizedEntityName.replace(/\s+/g, '_')}`;
      results.entities.set(mainEntityId, {
        name: sanitizedEntityName,
        descriptions: [{ text: dbpediaResults.mainEntity.comment || `Information about ${sanitizedEntityName}` }],
        types: [{ type: 'Thing' }],
        sources: ['dbpedia'],
        confidence: 0.95,
        externalLinks: [],
        equivalentClasses: []
      });
      
      // Add related entities from DBpedia
      for (const related of dbpediaResults.relatedEntities) {
        const entityId = `dbpedia-related-${Math.random().toString(36).substr(2, 9)}`;
        const entityName = related.resourceLabel?.value || related.resource?.value?.split('/').pop() || 'Unknown';
        
        // Safely extract description text from SPARQL result
        const descriptionText = safeExtractText(related.comment, `Related to ${entityName}`);
        
        results.entities.set(entityId, {
          name: entityName,
          descriptions: [{ text: descriptionText }],
          types: [{ type: 'Related' }],
          sources: ['dbpedia'],
          confidence: 0.8,
          externalLinks: [],
          equivalentClasses: [],
          connectionInfo: {
            type: related.connectionType || 'related',
            value: related.connectionValue || 'Unknown',
            originalEntity: entityName
          }
        });
        
        // Add relationship
        results.relationships.push({
          source: mainEntityId,
          target: entityId,
          type: related.connectionType || 'related',
          confidence: 0.8
        });
      }
    }
    
    // 2. Try Wikidata search (if time permits)
    try {
      console.log(`[EnhancedSearch] Attempting Wikidata search for "${sanitizedEntityName}"`);
      const wikidataResults = await queryWikidata(sanitizedEntityName, { 
        timeout: timeout * 0.15, 
        searchType: 'fuzzy', 
        limit: Math.floor(limit * 0.2) 
      });
      
      for (const item of wikidataResults) {
        const entityId = `wikidata-${Math.random().toString(36).substr(2, 9)}`;
        const entityName = item.itemLabel?.value || 'Unknown';
        
        if (!Array.from(results.entities.values()).some(e => e.name === entityName)) {
          // Safely extract description text from SPARQL result
          const descriptionText = safeExtractText(item.itemDescription, `Wikidata entity: ${entityName}`);
          
          results.entities.set(entityId, {
            name: entityName,
            descriptions: [{ text: descriptionText }],
            types: [{ type: 'Thing' }],
            sources: ['wikidata'],
            confidence: 0.7,
            externalLinks: item.item?.value ? [item.item.value] : [],
            equivalentClasses: []
          });
        }
      }
    } catch (error) {
      console.warn('[EnhancedSearch] Wikidata search failed:', error);
    }
    
    // 3. Try Wikipedia search (if time permits)
    if (includeWikipedia) {
      try {
        console.log(`[EnhancedSearch] Attempting Wikipedia search for "${sanitizedEntityName}"`);
        const wikipediaResults = await queryWikipedia(sanitizedEntityName, { timeout: timeout * 0.15 });
        
        if (wikipediaResults && wikipediaResults.page) {
          const entityId = `wikipedia-${Math.random().toString(36).substr(2, 9)}`;
          const entityName = wikipediaResults.page.title;
          
          if (!Array.from(results.entities.values()).some(e => e.name === entityName)) {
            // Safely extract description text
            const descriptionText = safeExtractText(wikipediaResults.page.description, `Wikipedia article: ${entityName}`);
            
            results.entities.set(entityId, {
              name: entityName,
              descriptions: [{ text: descriptionText }],
              types: [{ type: 'Article' }],
              sources: ['wikipedia'],
              confidence: 0.8,
              externalLinks: wikipediaResults.page.url ? [wikipediaResults.page.url] : [],
              equivalentClasses: []
            });
          }
        }
      } catch (error) {
        console.warn('[EnhancedSearch] Wikipedia search failed:', error);
      }
    }
    
    // 4. Clean up any remaining complex objects and ensure all values are strings
    for (const [entityId, entityData] of results.entities.entries()) {
      // Ensure name is a string
      if (typeof entityData.name !== 'string') {
        entityData.name = String(entityData.name || 'Unknown');
      }
      
      // Ensure descriptions are properly formatted
      if (entityData.descriptions && entityData.descriptions.length > 0) {
        for (const desc of entityData.descriptions) {
          if (typeof desc.text !== 'string') {
            desc.text = String(desc.text || 'No description available');
          }
        }
      }
      
      // Ensure types are properly formatted
      if (entityData.types && entityData.types.length > 0) {
        for (const type of entityData.types) {
          if (typeof type.type !== 'string') {
            type.type = String(type.type || 'Thing');
          }
        }
      }
    }
    
    // 5. Update metadata
    results.metadata.totalEntities = results.entities.size;
    results.metadata.totalRelationships = results.relationships.length;
    
    console.log(`[EnhancedSearch] Completed search for "${sanitizedEntityName}": ${results.metadata.totalEntities} entities, ${results.metadata.totalRelationships} relationships`);
    
    return results;
    
  } catch (error) {
    console.error('[EnhancedSearch] Enhanced semantic search failed:', error);
    return {
      entities: new Map(),
      relationships: [],
      metadata: {
        searchTerm: entityName,
        sources: [],
        totalEntities: 0,
        totalRelationships: 0,
        searchTime: new Date().toISOString(),
        error: error.message
      }
    };
  }
}