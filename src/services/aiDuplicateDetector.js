/**
 * AI-Driven Duplicate Detection
 * 
 * Uses LLM to intelligently detect if nodes are duplicates or near-duplicates,
 * even when names differ slightly (fuzzy matching with semantic understanding).
 */

/**
 * Check if a new node is a duplicate of any existing nodes using AI
 * @param {string} newNodeName - Name of the node to check
 * @param {Array} existingNodes - Array of existing node objects with {name, description}
 * @param {Function} llmCall - Function to call LLM (async)
 * @returns {Promise<Object|null>} Matching node if duplicate, null if unique
 */
export async function findDuplicateNode(newNodeName, existingNodes, llmCall) {
  if (!newNodeName || !existingNodes || existingNodes.length === 0) {
    return null;
  }
  
  // Fast path: exact match (case-insensitive)
  const exactMatch = existingNodes.find(n => 
    n.name?.toLowerCase() === newNodeName.toLowerCase()
  );
  if (exactMatch) {
    return { node: exactMatch, confidence: 'exact' };
  }
  
  // If we have too many nodes, only check the most similar ones by string similarity
  let nodesToCheck = existingNodes;
  if (existingNodes.length > 20) {
    nodesToCheck = existingNodes
      .map(n => ({
        node: n,
        similarity: stringSimilarity(newNodeName, n.name)
      }))
      .filter(item => item.similarity > 0.3) // Only check nodes with >30% string similarity
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10) // Top 10 most similar
      .map(item => item.node);
  }
  
  if (nodesToCheck.length === 0) {
    return null;
  }
  
  // Build LLM prompt for semantic duplicate detection
  const prompt = `You are a knowledge graph deduplication expert. Determine if a new node is a duplicate of any existing nodes.

NEW NODE TO ADD: "${newNodeName}"

EXISTING NODES:
${nodesToCheck.map((n, i) => `${i + 1}. "${n.name}"${n.description ? ` - ${n.description}` : ''}`).join('\n')}

TASK: Is the new node "${newNodeName}" a duplicate or near-duplicate of ANY existing node?

Consider:
- Same entity with different names (e.g., "The Avengers" vs "Avengers")
- Abbreviations (e.g., "S.H.I.E.L.D." vs "Shield")
- Singular/plural (e.g., "Infinity Stone" vs "Infinity Stones")
- Obvious typos or variations

RESPOND WITH JSON ONLY:
{
  "isDuplicate": true/false,
  "matchIndex": <number 1-${nodesToCheck.length} or null>,
  "keepExisting": true/false,
  "mergedName": "best name to use (if merging)",
  "mergedDescription": "combined description (if merging)",
  "reason": "brief explanation"
}

If duplicate:
- Set "keepExisting": true to keep the existing node and discard the new one
- Set "keepExisting": false to replace the existing with the new one
- Provide "mergedName" as the best name (usually the more specific/complete one)
- Provide "mergedDescription" combining both descriptions if useful`;

  try {
    const response = await llmCall(prompt, { max_tokens: 200, temperature: 0.1 });
    const result = JSON.parse(response);
    
    if (result.isDuplicate && result.matchIndex && result.matchIndex > 0 && result.matchIndex <= nodesToCheck.length) {
      const matchedNode = nodesToCheck[result.matchIndex - 1];
      console.log(`[AI Dedup] "${newNodeName}" is duplicate of "${matchedNode.name}" - ${result.reason}`);
      
      return {
        node: matchedNode,
        confidence: 'ai',
        reason: result.reason,
        action: result.keepExisting ? 'keep_existing' : 'replace',
        mergedName: result.mergedName || matchedNode.name,
        mergedDescription: result.mergedDescription || matchedNode.description
      };
    }
    
    return null;
  } catch (err) {
    console.warn('[AI Dedup] LLM call failed, falling back to exact match:', err.message);
    return null; // Fall back to creating new node if AI check fails
  }
}

/**
 * Simple string similarity using Levenshtein-like metric
 * @param {string} str1 
 * @param {string} str2 
 * @returns {number} Similarity score 0-1
 */
function stringSimilarity(str1, str2) {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return 0;
  
  // Simple bigram similarity
  const bigrams1 = getBigrams(s1);
  const bigrams2 = getBigrams(s2);
  
  let intersection = 0;
  bigrams1.forEach(bigram => {
    if (bigrams2.has(bigram)) {
      intersection++;
      bigrams2.delete(bigram);
    }
  });
  
  const union = bigrams1.size + bigrams2.size + intersection;
  return (2 * intersection) / union;
}

/**
 * Get bigrams (pairs of adjacent characters) from string
 */
function getBigrams(str) {
  const bigrams = new Set();
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.add(str.slice(i, i + 2));
  }
  return bigrams;
}

/**
 * Batch check multiple new nodes against existing nodes
 * Returns map of newNodeName -> matchedNode
 */
export async function findDuplicateNodes(newNodeNames, existingNodes, llmCall) {
  const results = new Map();
  
  // Process in parallel batches of 5
  const batchSize = 5;
  for (let i = 0; i < newNodeNames.length; i += batchSize) {
    const batch = newNodeNames.slice(i, i + batchSize);
    const promises = batch.map(name => findDuplicateNode(name, existingNodes, llmCall));
    const batchResults = await Promise.all(promises);
    
    batch.forEach((name, idx) => {
      if (batchResults[idx]) {
        results.set(name, batchResults[idx]);
      }
    });
  }
  
  return results;
}

