/**
 * Quick test to verify SPARQL client fix
 */

import { sparqlClient } from './src/services/sparqlClient.js';

async function testSparqlFix() {
  console.log('🔧 Testing SPARQL Client Fix...\n');

  try {
    console.log('Testing Wikidata query...');
    const results = await sparqlClient.executeQuery('wikidata', `
      SELECT DISTINCT ?item ?itemLabel WHERE {
        ?item rdfs:label "Apple Inc"@en .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
      } LIMIT 2
    `);

    console.log('✅ SPARQL query successful!');
    console.log(`   Results: ${results.length}`);
    if (results.length > 0) {
      console.log(`   First result: ${results[0].itemLabel?.value || 'No label'}`);
    }

  } catch (error) {
    console.log(`❌ SPARQL query failed: ${error.message}`);
  }

  console.log('\n🎯 SPARQL Fix Test Complete!');
}

testSparqlFix().catch(console.error);