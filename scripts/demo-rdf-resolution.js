#!/usr/bin/env node

/**
 * Demo script for RDF Resolution & SPARQL Integration
 * 
 * This script demonstrates the basic functionality of the new semantic web services.
 * Run with: node scripts/demo-rdf-resolution.js
 */

import { rdfResolver } from '../src/services/rdfResolver.js';
import { sparqlClient } from '../src/services/sparqlClient.js';
import { semanticEnrichment } from '../src/services/semanticEnrichment.js';
import { rdfValidation } from '../src/services/rdfValidation.js';

console.log('🚀 Redstring RDF Resolution & SPARQL Integration Demo\n');

async function runDemo() {
  try {
    console.log('1️⃣ Testing RDF Resolver...');
    
    // Test with a simple URI (this will likely fail in demo, but shows the flow)
    try {
      console.log('   Attempting to resolve: http://example.com/test');
      const result = await rdfResolver.resolveURI('http://example.com/test');
      console.log('   ✅ Resolution successful:', result);
    } catch (error) {
      console.log('   ⚠️  Resolution failed (expected in demo):', error.message);
    }

    console.log('\n2️⃣ Testing SPARQL Client...');
    
    // Test endpoint connectivity
    console.log('   Testing endpoint connectivity...');
    const endpoints = ['wikidata', 'dbpedia', 'schema'];
    
    for (const endpoint of endpoints) {
      try {
        const status = await sparqlClient.testEndpoint(endpoint);
        console.log(`   ${endpoint}: ${status.status} ${status.responseTime ? `(${status.responseTime}ms)` : ''}`);
      } catch (error) {
        console.log(`   ${endpoint}: error - ${error.message}`);
      }
    }

    console.log('\n3️⃣ Testing Semantic Enrichment...');
    
    // Test suggestion generation
    const mockNodeData = {
      id: 'demo-node-1',
      name: 'Artificial Intelligence',
      description: 'The field of computer science focused on creating intelligent machines',
      typeNodeId: 'demo-type-1'
    };

    try {
      console.log('   Generating suggestions for:', mockNodeData.name);
      const suggestions = await semanticEnrichment.suggestExternalLinks(mockNodeData.id, mockNodeData);
      console.log(`   ✅ Generated ${suggestions.length} suggestions`);
      
      if (suggestions.length > 0) {
        console.log('   Top suggestion:', suggestions[0]);
      }
    } catch (error) {
      console.log('   ⚠️  Suggestions failed:', error.message);
    }

    console.log('\n4️⃣ Testing RDF Validation...');
    
    // Test validation
    const mockGraphData = {
      id: 'demo-graph-1',
      nodes: [
        {
          id: 'node-1',
          name: 'Test Node',
          typeNodeId: 'type-1',
          externalLinks: ['http://example.com/test']
        },
        {
          id: 'type-1',
          name: 'Test Type',
          description: 'A test type for validation'
        }
      ],
      edges: []
    };

    try {
      console.log('   Validating mock graph...');
      const validationResults = await rdfValidation.validateGraph(mockGraphData);
      console.log(`   ✅ Validation completed in ${validationResults.duration}ms`);
      console.log(`   Found ${validationResults.summary.errors} errors, ${validationResults.summary.warnings} warnings`);
    } catch (error) {
      console.log('   ⚠️  Validation failed:', error.message);
    }

    console.log('\n5️⃣ Cache Statistics...');
    
    // Show cache stats
    const rdfCacheStats = rdfResolver.getCacheStats();
    const sparqlCacheStats = sparqlClient.getCacheStats();
    
    console.log('   RDF Resolver Cache:', rdfCacheStats);
    console.log('   SPARQL Client Cache:', sparqlCacheStats);

    console.log('\n6️⃣ Service Status...');
    
    // Show service status
    const validationStats = rdfValidation.getValidationStats();
    const enrichmentStats = semanticEnrichment.getQueueStats();
    
    console.log('   Validation Service:', validationStats);
    console.log('   Enrichment Service:', enrichmentStats);

    console.log('\n🎉 Demo completed successfully!');
    console.log('\nNext steps:');
    console.log('   • Open the Redstring UI and navigate to a node with external links');
    console.log('   • Use the "Resolve Links" button to test URI resolution');
    console.log('   • Try the "Get Suggestions" button for AI-powered link suggestions');
    console.log('   • Use the "Validate" button to check semantic consistency');
    console.log('   • Explore the RDF Resolution Panel for detailed results');

  } catch (error) {
    console.error('❌ Demo failed:', error);
    process.exit(1);
  }
}

// Run the demo
runDemo().catch(console.error);
