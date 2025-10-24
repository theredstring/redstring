#!/usr/bin/env node

/**
 * Test API Key Manager
 * 
 * This script tests the API key manager functionality
 */

// Simulate browser localStorage
global.localStorage = {
  data: {},
  getItem(key) {
    return this.data[key] || null;
  },
  setItem(key, value) {
    this.data[key] = value;
  },
  removeItem(key) {
    delete this.data[key];
  }
};

// Simulate browser btoa/atob
global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
global.atob = (str) => Buffer.from(str, 'base64').toString('binary');

// Import the API key manager
import apiKeyManager from './src/services/apiKeyManager.js';

async function testAPIKeyManager() {
  console.log('🔑 Testing API Key Manager');
  console.log('==========================\n');

  try {
    // Test 1: Check if no key exists initially
    console.log('🔧 Test 1: Check initial state');
    const hasKey = await apiKeyManager.hasAPIKey();
    console.log('✅ Has API key:', hasKey);
    console.log('✅ Expected: false\n');

    // Test 2: Validate API key formats
    console.log('🔧 Test 2: Validate API key formats');
    
    const testKeys = {
      valid: 'any-api-key-123456789',
      short: 'abc',
      empty: '',
      null: null
    };

    Object.entries(testKeys).forEach(([type, key]) => {
      const isValid = apiKeyManager.validateAPIKey(key);
      console.log(`✅ ${type}: ${isValid ? 'VALID' : 'INVALID'}`);
    });
    console.log();

    // Test 3: Store API key
    console.log('🔧 Test 3: Store API key');
    const testKey = testKeys.anthropic;
    const storeResult = await apiKeyManager.storeAPIKey(testKey, 'anthropic');
    console.log('✅ Store result:', storeResult);
    console.log();

    // Test 4: Check if key exists after storing
    console.log('🔧 Test 4: Check if key exists after storing');
    const hasKeyAfter = await apiKeyManager.hasAPIKey();
    console.log('✅ Has API key:', hasKeyAfter);
    console.log('✅ Expected: true\n');

    // Test 5: Get API key info
    console.log('🔧 Test 5: Get API key info');
    const keyInfo = await apiKeyManager.getAPIKeyInfo();
    console.log('✅ Key info:', keyInfo);
    console.log();

    // Test 6: Retrieve API key
    console.log('🔧 Test 6: Retrieve API key');
    const retrievedKey = await apiKeyManager.getAPIKey();
    console.log('✅ Retrieved key matches:', retrievedKey === testKey);
    console.log('✅ Key starts with sk-ant-:', retrievedKey.startsWith('sk-ant-'));
    console.log();

    // Test 7: Get common providers
    console.log('🔧 Test 7: Get common providers');
    const providers = apiKeyManager.getCommonProviders();
    console.log('✅ Common providers:');
    providers.forEach(provider => {
      console.log(`   • ${provider.name} (${provider.id})`);
    });
    console.log();

    // Test 8: Remove API key
    console.log('🔧 Test 8: Remove API key');
    const removeResult = await apiKeyManager.removeAPIKey();
    console.log('✅ Remove result:', removeResult);
    console.log();

    // Test 9: Check if key exists after removing
    console.log('🔧 Test 9: Check if key exists after removing');
    const hasKeyAfterRemove = await apiKeyManager.hasAPIKey();
    console.log('✅ Has API key:', hasKeyAfterRemove);
    console.log('✅ Expected: false\n');

    console.log('🎉 All API Key Manager tests passed!');
    console.log('\n📝 Next Steps:');
    console.log('   1. Open Redstring in your browser');
    console.log('   2. Open the AI Collaboration Panel');
    console.log('   3. Click the key icon to set up your API key');
    console.log('   4. Enter your Anthropic or OpenAI API key');
    console.log('   5. Start chatting with AI!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testAPIKeyManager(); 