# Redstring MCP Troubleshooting Guide

## Common Issues and Solutions

### ❌ **"Prototype 'X' not found" Error**

**Problem**: You're trying to create an instance of a prototype that doesn't exist, or you're using the wrong identifier.

**Error Message**:
```
❌ Error adding instance to Redstring store: HTTP 404: Not Found
```

**Root Cause**: 
1. The prototype was never created or doesn't exist in the current Redstring data
2. You're using a prototype ID instead of name (or vice versa)
3. The prototype name has different capitalization

**Solutions**:

#### Option 1: Create the Prototype First
```bash
# Create the prototype first
curl -X POST http://localhost:3001/api/bridge/actions/add-node-prototype \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Emergence",
    "description": "The emergence of complex behavior from simple interactions",
    "color": "#800080"
  }'

# Then add the instance (using name OR ID)
curl -X POST http://localhost:3001/api/bridge/actions/add-node-instance \
  -H "Content-Type: application/json" \
  -d '{
    "graphId": "your-graph-id",
    "prototypeName": "Emergence",
    "position": {"x": 200, "y": 200}
  }'

# Or using the prototype ID
curl -X POST http://localhost:3001/api/bridge/actions/add-node-instance \
  -H "Content-Type: application/json" \
  -d '{
    "graphId": "your-graph-id",
    "prototypeName": "prototype-1234567890-abcdef",
    "position": {"x": 200, "y": 200}
  }'
```

#### Option 2: Use AI-Guided Workflow (Recommended)
```bash
curl -X POST http://localhost:3001/api/bridge/actions/ai-guided-workflow \
  -H "Content-Type: application/json" \
  -d '{
    "workflowType": "full_workflow",
    "prototypeName": "Emergence",
    "prototypeDescription": "The emergence of complex behavior from simple interactions",
    "prototypeColor": "#800080",
    "instancePositions": [
      {"prototypeName": "Emergence", "x": 200, "y": 200}
    ]
  }'
```

#### Option 3: Check Available Prototypes
```bash
# See what prototypes exist (names and IDs)
curl -s http://localhost:3001/api/bridge/state | jq '.nodePrototypes | map({name, id})'

# Or just names
curl -s http://localhost:3001/api/bridge/state | jq '.nodePrototypes | map(.name)'

# Or just IDs
curl -s http://localhost:3001/api/bridge/state | jq '.nodePrototypes | map(.id)'
```

### ❌ **"No active graph" Error**

**Problem**: You're trying to add an instance but no graph is active.

**Solutions**:
```bash
# List available graphs
curl -s http://localhost:3001/api/bridge/state | jq '.graphs | map({id, name})'

# Open a specific graph
curl -X POST http://localhost:3001/api/bridge/actions/open-graph-tab \
  -H "Content-Type: application/json" \
  -d '{"graphId": "your-graph-id"}'
```

### ❌ **MCP Server Connection Issues**

**Problem**: Claude Desktop can't connect to the Redstring MCP server.

**Solutions**:

1. **Check if MCP server is running**:
   ```bash
   ps aux | grep "redstring-mcp-server"
   ```

2. **Restart the MCP server**:
   ```bash
   pkill -f "redstring-mcp-server"
   sleep 1
   node redstring-mcp-server.js &
   ```

3. **Check Claude Desktop MCP settings**:
   - Go to Settings → MCP Servers
   - Verify the path to `redstring-mcp-server.js` is correct
   - Restart Claude Desktop

### ❌ **Bridge Server Connection Issues**

**Problem**: MCP server can't connect to the Redstring bridge.

**Solutions**:

1. **Check if bridge server is running**:
   ```bash
   curl -s http://localhost:3001/api/bridge/state
   ```

2. **Restart the bridge server**:
   ```bash
   pkill -f "server.js"
   sleep 1
   npm run server &
   ```

3. **Check bridge server logs** for errors

### ❌ **Tools Not Available in Claude Desktop**

**Problem**: MCP tools don't appear in Claude Desktop.

**Solutions**:

1. **Restart Claude Desktop** completely
2. **Check MCP server connection** in Claude Desktop settings
3. **Verify all services are running**:
   ```bash
   # Check bridge
   curl -s http://localhost:3001/api/bridge/state | jq '.graphs | length'
   
   # Check MCP server
   ps aux | grep "redstring-mcp-server"
   ```

## Testing Your Setup

### Quick Health Check
```bash
# Test script to verify everything is working
node test-add-instance.js
```

### Full Workflow Test
```bash
# Test the complete AI-guided workflow
node test-ai-workflow.js
```

### Manual API Tests
```bash
# Test prototype creation
curl -X POST http://localhost:3001/api/bridge/actions/add-node-prototype \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","description":"Test prototype","color":"#FF0000"}'

# Test instance creation
curl -X POST http://localhost:3001/api/bridge/actions/add-node-instance \
  -H "Content-Type: application/json" \
  -d '{"graphId":"your-graph-id","prototypeName":"Test","position":{"x":100,"y":100}}'
```

## Debug Mode

### Enable Detailed Logging

1. **MCP Server Logs**:
   ```bash
   node redstring-mcp-server.js 2>&1 | tee mcp-server.log
   ```

2. **Bridge Server Logs**:
   ```bash
   npm run server 2>&1 | tee bridge-server.log
   ```

3. **Claude Desktop Logs**:
   - Check Claude Desktop console for MCP messages
   - Look for connection errors or tool registration issues

### Common Log Messages

**✅ Success Indicators**:
```
✅ Bridge: Store data updated
✅ Bridge: Prototype added successfully
✅ Bridge: Instance added successfully
✅ Redstring store bridge established
```

**❌ Error Indicators**:
```
❌ Bridge: Failed to add prototype
❌ Bridge: Failed to add instance
❌ Error in getGraphData
❌ Prototype 'X' not found
```

## ✅ **Recent Fixes**

### **Prototype ID/Name Support (Fixed)**
The `add_node_instance` tool now supports both prototype names and IDs:

- ✅ **Prototype names**: `"Charles McGill"`
- ✅ **Prototype IDs**: `"33b579d9-9d19-4c03-b802-44de24055f23"`
- ✅ **Case-insensitive matching**: `"charles mcgill"` works
- ✅ **Better error messages**: Shows available prototypes when not found

**Example**:
```bash
# Using name
curl -X POST http://localhost:3001/api/bridge/actions/add-node-instance \
  -H "Content-Type: application/json" \
  -d '{"graphId":"graph-id","prototypeName":"Charles McGill","position":{"x":100,"y":100}}'

# Using ID
curl -X POST http://localhost:3001/api/bridge/actions/add-node-instance \
  -H "Content-Type: application/json" \
  -d '{"graphId":"graph-id","prototypeName":"33b579d9-9d19-4c03-b802-44de24055f23","position":{"x":100,"y":100}}'
```

## Prevention Tips

### 1. **Always Use AI-Guided Workflow for Complex Tasks**
The `ai_guided_workflow` tool handles prototype creation automatically and provides better error handling.

### 2. **Check Before Creating**
Always verify that prototypes and graphs exist before trying to use them.

### 3. **Use the Right Tool for the Job**
- **Individual actions**: Use specific tools like `add_node_prototype`
- **Complete workflows**: Use `ai_guided_workflow` with `full_workflow`
- **Exploration**: Use `list_available_graphs` and `get_active_graph`

### 4. **Keep Services Running**
Use the connection wizard to monitor service status:
```bash
node ai-connection-wizard-simple.js
```

## Getting Help

If you're still having issues:

1. **Check the logs** for specific error messages
2. **Verify all services** are running and connected
3. **Test with the provided scripts** to isolate the issue
4. **Check the documentation** in `AI_GUIDED_WORKFLOW.md`
5. **Use the system prompt** to ensure Claude knows how to use the tools correctly 