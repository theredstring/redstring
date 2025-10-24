import { findRelatedThroughDBpediaProperties, queryDBpedia, discoverDBpediaProperties } from './src/services/semanticWebQuery.js';

async function testDBpediaProperties() {
  console.log('🧪 Testing DBpedia Property-Based Search...\n');

  // Test 1: Basic DBpedia query with properties
  console.log('1. Testing DBpedia query with properties for "LittleBigPlanet"...');
  try {
    const results = await queryDBpedia('LittleBigPlanet', {
      searchType: 'exact',
      includeProperties: true,
      limit: 5
    });
    
    console.log(`   Found ${results.length} results with properties:`);
    results.forEach((result, index) => {
      console.log(`   ${index + 1}. Resource: ${result.resource?.value || 'N/A'}`);
      console.log(`       Label: ${result.label?.value || result.resourceLabel?.value || 'N/A'}`);
      console.log(`       Comment: ${result.comment?.value || 'N/A'}`);
      
      if (result.property && result.propertyValue) {
        console.log(`       Property: ${result.property.value} -> ${result.propertyValue.value}`);
      }
    });
  } catch (error) {
    console.error('   ❌ DBpedia query failed:', error.message);
  }

  console.log('\n2. Testing Property-Based Related Entities...');
  try {
    const relatedResults = await findRelatedThroughDBpediaProperties('LittleBigPlanet', {
      limit: 10,
      propertyTypes: ['genre', 'developer', 'publisher', 'platform']
    });
    
    console.log(`   Found ${relatedResults.length} related entities through properties:`);
    relatedResults.slice(0, 5).forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.resourceLabel?.value || 'Unknown'}`);
      console.log(`       Connected via: ${result.connectionType} = ${result.connectionValue}`);
      if (result.comment?.value) {
        console.log(`       Description: ${result.comment.value.substring(0, 100)}...`);
      }
    });
  } catch (error) {
    console.error('   ❌ Property-based search failed:', error.message);
  }

  console.log('\n3. Testing Property Discovery for "LittleBigPlanet"...');
  try {
    console.log('   Looking for specific properties...');
    const specificProperties = await discoverDBpediaProperties('LittleBigPlanet', { 
      limit: 20, 
      specificProperties: true 
    });
    
    console.log(`   Found ${specificProperties.length} specific properties:`);
    specificProperties.forEach((prop, index) => {
      console.log(`   ${index + 1}. ${prop.propertyLabel || prop.property} -> ${prop.valueLabel || prop.value}`);
    });
    
    console.log('\n   Looking for ALL available properties...');
    const allProperties = await discoverDBpediaProperties('LittleBigPlanet', { 
      limit: 30, 
      specificProperties: false 
    });
    
    console.log(`   Found ${allProperties.length} total properties:`);
    allProperties.slice(0, 15).forEach((prop, index) => {
      const propertyName = prop.propertyLabel || prop.property?.split('/').pop() || 'Unknown';
      const valueName = prop.valueLabel || prop.value?.split('/').pop() || 'Unknown';
      console.log(`   ${index + 1}. ${propertyName} -> ${valueName}`);
    });
    
    if (allProperties.length > 15) {
      console.log(`   ... and ${allProperties.length - 15} more properties`);
    }
  } catch (error) {
    console.error('   ❌ Property discovery failed:', error.message);
  }

  console.log('\n4. Testing with a different gaming entity...');
  try {
    const results = await findRelatedThroughDBpediaProperties('Minecraft', {
      limit: 5,
      propertyTypes: ['genre', 'developer', 'platform']
    });
    
    console.log(`   Found ${results.length} entities related to Minecraft:`);
    results.slice(0, 3).forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.resourceLabel?.value || 'Unknown'}`);
      console.log(`       Connected via: ${result.connectionType} = ${result.connectionValue}`);
    });
  } catch (error) {
    console.error('   ❌ Minecraft search failed:', error.message);
  }

  console.log('\n✅ DBpedia Property-Based Search Test Complete!');
}

// Run the test
testDBpediaProperties().catch(console.error);
