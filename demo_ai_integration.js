/**
 * Demo: AI Integration with Redstring
 * 
 * This script demonstrates how to use the AI collaboration features
 * that we just integrated into Redstring.
 */

// Demo 1: Basic AI Collaboration
async function demoBasicAICollaboration() {
  console.log('🤖 Demo 1: Basic AI Collaboration');
  console.log('=====================================');
  
  // Initialize AI client
  const ai = await mcpClient.initialize();
  console.log('✅ AI Client initialized with session:', ai.sessionId);
  
  // Explore knowledge graph
  console.log('🔍 Exploring knowledge graph...');
  const exploration = await ai.exploreKnowledge('climate_change', {
    maxDepth: 2,
    includePatterns: true
  });
  
  console.log('📊 Exploration Results:');
  console.log('- Nodes visited:', exploration.exploration.result.total_nodes_visited);
  console.log('- Patterns found:', exploration.patterns.result.total_patterns_found);
  console.log('- Insights:', exploration.insights.length);
  
  // Create concept map
  console.log('🗺️ Creating concept map...');
  const conceptMap = await ai.createConceptMap('sustainability', [
    { name: 'Renewable Energy', description: 'Clean energy sources' },
    { name: 'Carbon Pricing', description: 'Economic incentives' },
    { name: 'Policy Framework', description: 'Regulatory structures' }
  ], {
    autoConnect: true,
    confidenceThreshold: 0.7
  });
  
  console.log('✅ Concept map created:');
  console.log('- Entities:', conceptMap.entities.length);
  console.log('- Relationships:', conceptMap.relationships.length);
  
  // Collaborative reasoning
  console.log('🧠 Starting collaborative reasoning...');
  const collaboration = await ai.collaborativeReasoning(
    'How can we accelerate renewable energy adoption?',
    {
      maxIterations: 2,
      confidenceThreshold: 0.7
    }
  );
  
  console.log('💡 Collaborative reasoning complete:');
  console.log('- Iterations:', collaboration.iterations.length);
  console.log('- Final insights:', collaboration.finalInsights.length);
  console.log('- Recommendations:', collaboration.recommendations.length);
  
  return { exploration, conceptMap, collaboration };
}

// Demo 2: Advanced AI Operations
async function demoAdvancedAIOperations() {
  console.log('\n🤖 Demo 2: Advanced AI Operations');
  console.log('=====================================');
  
  const ai = await mcpClient.initialize();
  
  // Pattern recognition
  console.log('🔍 Identifying patterns...');
  const patterns = await ai.executeTool('identify_patterns', {
    pattern_type: 'semantic',
    min_occurrences: 2
  });
  
  console.log('📈 Pattern Analysis:');
  console.log('- Patterns found:', patterns.result.total_patterns_found);
  
  // Spatial-semantic reasoning
  console.log('🌐 Spatial-semantic reasoning...');
  const spatialAnalysis = await ai.spatialSemanticReasoning(
    'Analyze spatial clustering of related concepts',
    {
      includeSpatialPatterns: true,
      includeSemanticPatterns: true
    }
  );
  
  console.log('📍 Spatial Analysis:');
  console.log('- Spatial patterns:', spatialAnalysis.spatialAnalysis ? 'Found' : 'None');
  console.log('- Semantic patterns:', spatialAnalysis.semanticAnalysis ? 'Found' : 'None');
  console.log('- Integrated insights:', spatialAnalysis.integratedInsights.length);
  
  // Recursive exploration
  console.log('🔄 Recursive exploration...');
  const recursiveExploration = await ai.recursiveExploration('sustainability', {
    maxDepth: 3,
    depthControl: 'adaptive',
    includeAbstractions: true
  });
  
  console.log('🌳 Recursive Exploration:');
  console.log('- Exploration tree depth:', recursiveExploration.explorationTree ? 'Built' : 'None');
  console.log('- Abstractions created:', recursiveExploration.abstractions.length);
  
  return { patterns, spatialAnalysis, recursiveExploration };
}

// Demo 3: Real-time Chat Interface
async function demoChatInterface() {
  console.log('\n🤖 Demo 3: Real-time Chat Interface');
  console.log('=====================================');
  
  console.log('💬 Chat Interface Features:');
  console.log('- Natural language interaction');
  console.log('- Real-time typing indicators');
  console.log('- Session persistence');
  console.log('- Confidence scoring');
  console.log('- Collaboration history');
  
  console.log('\n🎯 How to use the chat interface:');
  console.log('1. Press "B" or click the brain icon in the header');
  console.log('2. Type questions like:');
  console.log('   - "Explore climate change concepts"');
  console.log('   - "Create a concept map for sustainability"');
  console.log('   - "Identify patterns in my knowledge graph"');
  console.log('   - "Help me understand renewable energy adoption"');
  
  console.log('\n🔧 Available operations:');
  console.log('- Knowledge exploration');
  console.log('- Concept mapping');
  console.log('- Literature analysis');
  console.log('- Pattern recognition');
  console.log('- Collaborative reasoning');
  console.log('- Spatial-semantic analysis');
  console.log('- Recursive exploration');
}

// Demo 4: Integration with Redstring UI
function demoUIIntegration() {
  console.log('\n🤖 Demo 4: UI Integration');
  console.log('=====================================');
  
  console.log('🎨 UI Components:');
  console.log('- AI Collaboration Panel (right sidebar)');
  console.log('- Brain icon in header (toggle button)');
  console.log('- Keyboard shortcut "B"');
  console.log('- Real-time connection status');
  console.log('- Session information display');
  
  console.log('\n📱 Panel Modes:');
  console.log('1. Chat Mode: Natural language interaction');
  console.log('2. Operations Mode: Direct tool access');
  console.log('3. Insights Mode: AI-generated insights');
  
  console.log('\n⚙️ Advanced Features:');
  console.log('- Session management');
  console.log('- Collaboration history');
  console.log('- Tool availability display');
  console.log('- Confidence scoring visualization');
}

// Main demo runner
async function runAllDemos() {
  console.log('🚀 Starting AI Integration Demos');
  console.log('=====================================');
  console.log('This demo shows the AI integration features we just added to Redstring!');
  console.log('');
  
  try {
    // Run demos
    await demoBasicAICollaboration();
    await demoAdvancedAIOperations();
    demoChatInterface();
    demoUIIntegration();
    
    console.log('\n✅ All demos completed successfully!');
    console.log('\n🎉 The AI integration is now live in Redstring!');
    console.log('\nTo try it out:');
    console.log('1. Press "B" or click the brain icon in the header');
    console.log('2. Start chatting with the AI about your knowledge graph');
    console.log('3. Explore the different modes and capabilities');
    
  } catch (error) {
    console.error('❌ Demo failed:', error);
    console.log('\n🔧 Troubleshooting:');
    console.log('- Make sure Redstring is running');
    console.log('- Check the browser console for errors');
    console.log('- Verify the AI collaboration panel is visible');
  }
}

// Export for use in browser console
if (typeof window !== 'undefined') {
  window.demoAI = {
    runAllDemos,
    demoBasicAICollaboration,
    demoAdvancedAIOperations,
    demoChatInterface,
    demoUIIntegration
  };
  
  console.log('🤖 AI Integration Demo loaded!');
  console.log('Run "demoAI.runAllDemos()" to see the demos in action!');
}

export {
  runAllDemos,
  demoBasicAICollaboration,
  demoAdvancedAIOperations,
  demoChatInterface,
  demoUIIntegration
}; 