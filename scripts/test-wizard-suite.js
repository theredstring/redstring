import { runSimulation as simulateUser } from './simulate-user.js';
import process from 'process';

const API_KEY = process.argv[2] || process.env.OPENROUTER_API_KEY;

if (!API_KEY) {
    console.error('Error: API Key is required. Pass it as the first argument or set OPENROUTER_API_KEY env var.');
    process.exit(1);
}

const SCENARIOS = [
    {
        name: 'Scenario A: Fresh Graph Creation',
        prompt: 'Create a graph about the primary colors and their mixes.',
        expected: { minNodes: 6, minEdges: 3 }
    },
    {
        name: 'Scenario B: Graph Expansion (Context Awareness)',
        prompt: 'Add the secondary colors if they are missing, and connect them to emotions.',
        expected: { minNodes: 3, minEdges: 3 } // Delta
    },
    {
        name: 'Scenario C: Complex Self-Directed Task',
        prompt: 'Create a detailed graph of the Lord of the Rings fellowship members, their races, and weapons.',
        expected: { minNodes: 15, minEdges: 15 }
    }
];

async function runSuite() {
    console.log('🚀 Starting Wizard Test Suite');
    console.log('===================================================\n');

    const results = [];

    for (const scenario of SCENARIOS) {
        console.log(`\n🧪 Running ${scenario.name}`);
        console.log(`   Prompt: "${scenario.prompt}"`);
        console.log('---------------------------------------------------');

        // Add delay between tests to let bridge settle
        if (results.length > 0) await new Promise(r => setTimeout(r, 5000));


        const result = await simulateUser(scenario.prompt, API_KEY);

        if (!result || !result.success) {
            console.log(`❌ ${scenario.name} FAILED (Simulation Error)`);
            console.log(`   Error: ${result?.error || 'Unknown error'}`);
            results.push({ scenario: scenario.name, passed: false, details: result });
            continue;
        }

        // Analyze results
        const passed = result.success &&
            result.final.nodes >= scenario.expected.minNodes &&
            result.final.edges >= scenario.expected.minEdges;

        results.push({
            scenario: scenario.name,
            passed,
            details: result
        });

        if (passed) {
            console.log(`✅ ${scenario.name} PASSED`);
        } else {
            console.log(`❌ ${scenario.name} FAILED`);
            console.log(`   Expected: >${scenario.expected.minNodes} nodes, >${scenario.expected.minEdges} edges`);
            console.log(`   Actual:   ${result.final.nodes} nodes, ${result.final.edges} edges`);
        }
    }

    console.log('\n===================================================');
    console.log('🏁 Test Suite Complete');
    console.log('===================================================');

    results.forEach(r => {
        console.log(`${r.passed ? '✅' : '❌'} ${r.scenario}`);
    });
}

runSuite();
