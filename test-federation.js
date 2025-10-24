/**
 * Test script for federated knowledge system
 * Tests mass import and federated search
 */

import { knowledgeFederation } from './src/services/knowledgeFederation.js';

async function testFederatedKnowledge() {
  console.log('🌐 Testing Federated Knowledge System...\n');

  // Test 1: Mass Import Knowledge Cluster
  try {
    console.log('1. Testing mass knowledge import for "Apple Inc"...');
    
    const results = await knowledgeFederation.importKnowledgeCluster('Apple Inc', {
      maxDepth: 1, // Shallow test
      maxEntitiesPerLevel: 3, // Small test
      includeRelationships: true,
      includeSources: ['wikidata', 'dbpedia'],
      onProgress: (progress) => {
        console.log(`   Progress: ${progress.stage} | ${progress.entity} | Level ${progress.level}`);
      }
    });

    console.log(`✅ Mass import completed!`);
    console.log(`   Total Entities: ${results.totalEntities}`);
    console.log(`   Total Relationships: ${results.totalRelationships}`);
    console.log(`   Sources: ${JSON.stringify(results.sourceBreakdown)}`);
    console.log(`   Clusters: ${results.clusters.size}`);
    console.log();

    // Show some entities
    if (results.entities.size > 0) {
      console.log('📋 Sample entities:');
      let count = 0;
      for (const [entityName, entityData] of results.entities) {
        console.log(`   ${entityName}: ${entityData.sources.join(', ')} (conf: ${entityData.confidence})`);
        if (++count >= 3) break;
      }
      console.log();
    }

    // Show some relationships
    if (results.relationships.length > 0) {
      console.log('🔗 Sample relationships:');
      for (let i = 0; i < Math.min(3, results.relationships.length); i++) {
        const rel = results.relationships[i];
        console.log(`   ${rel.source} → ${rel.relation} → ${rel.target} (conf: ${rel.confidence})`);
      }
      console.log();
    }

  } catch (error) {
    console.log(`❌ Mass import failed: ${error.message}`);
    console.log();
  }

  // Test 2: Federated Search
  try {
    console.log('2. Testing federated search for "artificial intelligence"...');
    
    const searchResults = await knowledgeFederation.federatedSearch('artificial intelligence', {
      sources: ['wikidata', 'dbpedia'],
      limit: 5,
      minConfidence: 0.5,
      includeSnippets: true
    });

    console.log(`✅ Search completed!`);
    console.log(`   Found ${searchResults.length} results`);
    console.log();

    // Show search results
    if (searchResults.length > 0) {
      console.log('🔍 Search results:');
      searchResults.forEach((result, i) => {
        console.log(`   ${i + 1}. ${result.title}`);
        console.log(`      Source: ${result.source} | Confidence: ${Math.round((result.confidence || 0) * 100)}%`);
        if (result.snippet) {
          console.log(`      Snippet: ${result.snippet.substring(0, 100)}...`);
        }
        console.log();
      });
    }

  } catch (error) {
    console.log(`❌ Federated search failed: ${error.message}`);
    console.log();
  }

  // Test 3: Single Entity Import
  try {
    console.log('3. Testing single entity import for "Machine Learning"...');
    
    const entityData = await knowledgeFederation.importSingleEntity('Machine Learning', ['wikidata', 'dbpedia']);

    console.log(`✅ Single entity import completed!`);
    console.log(`   Name: ${entityData.name}`);
    console.log(`   Sources: ${entityData.sources.join(', ')}`);
    console.log(`   Descriptions: ${entityData.descriptions.length}`);
    console.log(`   External Links: ${entityData.externalLinks.length}`);
    console.log(`   Types: ${entityData.types.length}`);
    console.log(`   Confidence: ${entityData.confidence}`);
    console.log();

  } catch (error) {
    console.log(`❌ Single entity import failed: ${error.message}`);
    console.log();
  }

  console.log('🎯 Federated Knowledge System Test Complete!');
}

// Run the test
testFederatedKnowledge().catch(console.error);