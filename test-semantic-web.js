/**
 * Test script for semantic web integration
 * Tests the new direct semantic web query functionality
 */

import { enrichFromSemanticWeb } from './src/services/semanticWebQuery.js';

async function testSemanticWebIntegration() {
  console.log('🌐 Testing Semantic Web Integration...\n');

  // Test comprehensive semantic web enrichment
  try {
    console.log('Testing comprehensive semantic web enrichment for "Electronic Arts"...');
    const results = await enrichFromSemanticWeb('Electronic Arts');
    
    console.log(`✅ Enrichment completed!`);
    console.log(`   External Links: ${results.suggestions.externalLinks.length}`);
    console.log(`   Description: ${results.suggestions.description ? 'Found' : 'None'}`);
    console.log(`   Confidence: ${(results.suggestions.confidence * 100).toFixed(1)}%`);
    console.log();
    
    console.log('📊 Source Results:');
    console.log(`   Wikidata: ${results.sources.wikidata?.found ? '✅ Found' : '❌ Not found'}`);
    console.log(`   DBpedia: ${results.sources.dbpedia?.found ? '✅ Found' : '❌ Not found'}`);
    console.log(`   Wikipedia: ${results.sources.wikipedia?.found ? '✅ Found' : '❌ Not found'}`);
    console.log();
    
    if (results.suggestions.externalLinks.length > 0) {
      console.log('🔗 External Links Found:');
      results.suggestions.externalLinks.forEach((link, i) => {
        console.log(`   ${i + 1}. ${link}`);
      });
      console.log();
    }
    
    if (results.suggestions.description) {
      console.log('📝 Description:');
      console.log(`   ${results.suggestions.description.substring(0, 200)}...`);
      console.log();
    }
    
  } catch (error) {
    console.log(`❌ Enrichment failed: ${error.message}`);
    console.log();
  }

  // Test with a different entity
  try {
    console.log('Testing enrichment for "Apple Inc"...');
    const results2 = await enrichFromSemanticWeb('Apple Inc');
    
    console.log(`✅ Second test completed!`);
    console.log(`   External Links: ${results2.suggestions.externalLinks.length}`);
    console.log(`   Description: ${results2.suggestions.description ? 'Found' : 'None'}`);
    console.log(`   Confidence: ${(results2.suggestions.confidence * 100).toFixed(1)}%`);
    console.log();
    
  } catch (error) {
    console.log(`❌ Second test failed: ${error.message}`);
    console.log();
  }

  console.log('🎯 Semantic Web Integration Test Complete!');
}

// Run the test
testSemanticWebIntegration().catch(console.error);