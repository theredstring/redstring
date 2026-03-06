import useGraphStore from './src/store/graphStore.jsx';
import useHistoryStore from './src/store/historyStore.js';

// Setup basic nodes
useGraphStore.getState().createNewGraph({
    id: 'test-graph',
    name: 'Test Graph',
    description: 'Test'
});

// Simulate applyToolResultToStore behavior
const store = useGraphStore.getState();

store.setChangeContext({ type: 'wizard_action', target: 'wizard', actionId: 'tool-call-123', isWizard: true });

store.applyBulkGraphUpdates('test-graph', {
    nodes: [{
        name: 'Node 1',
        color: '#5B6CFF',
        description: 'Test Node',
        x: 0,
        y: 0
    }]
});

// Wait for batch to flush
setTimeout(() => {
    const history = useHistoryStore.getState().history;
    console.log('History length:', history.length);
    console.log('Last actionId:', history[history.length - 1]?.actionId);
    console.log('Is wizard:', history[history.length - 1]?.isWizard);
    console.log('Full last entry:', JSON.stringify(history[history.length - 1], null, 2));
}, 100);
