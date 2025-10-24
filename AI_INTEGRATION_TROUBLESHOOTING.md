# AI Integration Troubleshooting Guide

## 🚀 Getting Started

### 1. **Access the AI Panel**
- **Method 1**: Press the `B` key anywhere in Redstring
- **Method 2**: Click the brain icon (🧠) in the header next to the bookmark icon
- **Expected**: A panel should slide in from the right side

### 2. **Check Connection Status**
- Look for the connection indicator in the AI panel header
- Should show "Connected" with a green dot
- If "Disconnected", check browser console for errors

## 🔧 Common Issues & Solutions

### Issue 1: AI Panel Not Appearing
**Symptoms**: Pressing 'B' or clicking brain icon does nothing

**Solutions**:
1. **Check Console**: Open browser dev tools (F12) and look for errors
2. **Verify Import**: The AI panel is now inline in `src/Panel.jsx` (left tab: AI)
3. **Check State**: Verify `showAICollaboration` state is properly initialized
4. **Refresh Page**: Sometimes React state gets stuck

**Debug Commands** (in browser console):
```javascript
// Check if AI panel state exists
console.log('AI Panel State:', window.showAICollaboration);

// Manually toggle AI panel
window.toggleAIPanel = () => {
  const event = new KeyboardEvent('keydown', { key: 'b' });
  document.dispatchEvent(event);
};
```

### Issue 2: MCP Connection Fails
**Symptoms**: Panel shows "Disconnected" or connection errors

**Solutions**:
1. **Check MCP Provider**: Verify `mcpProvider.js` is properly imported
2. **Check MCP Client**: Verify `mcpClient.js` is properly imported
3. **Check Store**: Make sure `useGraphStore` is accessible

**Debug Commands**:
```javascript
// Test MCP connection manually
import('./src/services/mcpClient.js').then(module => {
  const client = module.default;
  client.initialize().then(result => {
    console.log('MCP Connection:', result);
  }).catch(error => {
    console.error('MCP Error:', error);
  });
});
```

### Issue 3: AI Operations Not Working
**Symptoms**: Chat works but AI operations return errors

**Solutions**:
1. **Check Graph Data**: Make sure there are nodes in the active graph
2. **Check Store State**: Verify graph store has data
3. **Check Tool Registration**: Verify MCP tools are properly registered

**Debug Commands**:
```javascript
// Check graph store state
import('./src/store/graphStore.jsx').then(module => {
  const store = module.default;
  const state = store.getState();
  console.log('Graph Store State:', {
    activeGraphId: state.activeGraphId,
    graphsCount: state.graphs.size,
    nodesCount: state.nodes.size
  });
});
```

### Issue 4: UI Styling Issues
**Symptoms**: Panel appears but looks broken or unstyled

**Solutions**:
1. **Check CSS Import**: Verify `src/ai/AICollaborationPanel.css` is imported in `src/Panel.jsx`
2. **Check CSS Classes**: Verify CSS classes are properly applied
3. **Check Z-Index**: Panel might be behind other elements

**Debug Commands**:
```javascript
// Check if CSS is loaded
const styles = document.styleSheets;
const aiStyles = Array.from(styles).find(sheet => 
  sheet.href && sheet.href.includes('AICollaborationPanel.css')
);
console.log('AI CSS Loaded:', !!aiStyles);
```

## 🧪 Testing the Integration

### Quick Test Commands
Run these in the browser console to test different aspects:

```javascript
// Test 1: Basic Panel Toggle
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));

// Test 2: MCP Connection
import('./src/services/mcpClient.js').then(m => m.default.initialize());

// Test 3: Graph Store Access
import('./src/store/graphStore.jsx').then(m => console.log(m.default.getState()));

// Test 4: AI Operations
import('./src/services/mcpClient.js').then(async m => {
  const client = m.default;
  await client.initialize();
  const result = await client.exploreKnowledge('test', { maxDepth: 1 });
  console.log('AI Operation Result:', result);
});
```

### Manual Testing Checklist
- [ ] Press 'B' key → Panel appears
- [ ] Click brain icon → Panel toggles
- [ ] Panel shows "Connected" status
- [ ] Chat input accepts text
- [ ] AI responds to messages
- [ ] Operations mode shows available tools
- [ ] Insights mode displays AI insights
- [ ] Advanced options show session info

## 🐛 Debug Mode

Enable debug logging by adding this to the browser console:

```javascript
// Enable debug logging
localStorage.setItem('ai-debug', 'true');
console.log('AI Debug Mode Enabled');

// Check debug logs
const debugLogs = [];
const originalLog = console.log;
console.log = (...args) => {
  if (args[0] && args[0].includes('[AI')) {
    debugLogs.push(args);
  }
  originalLog.apply(console, args);
};
```

## 📞 Getting Help

If you're still having issues:

1. **Check Console**: Look for error messages in browser dev tools
2. **Check Network**: Look for failed requests in Network tab
3. **Check React DevTools**: Inspect component state and props
4. **Check File Structure**: Verify all files are in the correct locations

### File Structure Check
```
src/
├── Panel.jsx (contains inline AI panel) ✅
├── ai/AICollaborationPanel.css ✅
├── services/
│   ├── mcpProvider.js ✅
│   └── mcpClient.js ✅
└── NodeCanvas.jsx ✅ (updated with AI integration)
```

### Common Error Messages
- `Module not found`: Check file paths and imports
- `Cannot read property of undefined`: Check component props
- `MCP connection failed`: Check MCP server initialization
- `Graph store not found`: Check Zustand store setup

## 🎯 Success Indicators

When everything is working correctly, you should see:

1. **Visual**: Brain icon in header, panel slides in from right
2. **Console**: `[AI Collaboration] Initializing connection...` messages
3. **Status**: "Connected" with green indicator in panel
4. **Functionality**: Can send messages and receive AI responses
5. **Performance**: Smooth animations and responsive UI

---

**Remember**: The AI integration is designed to be robust and self-healing. Most issues can be resolved by refreshing the page or checking the console for specific error messages. 