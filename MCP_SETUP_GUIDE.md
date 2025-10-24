# Redstring MCP Integration with Claude Desktop

## 🎯 **What We've Built**

A proper **MCP (Model Context Protocol) server** that connects Redstring to Claude Desktop, following the official MCP specification.

### **✅ Components Created**

1. **MCP Server**: `redstring-mcp-server.js` - Provides tools for Claude Desktop
2. **Claude Desktop Config**: Updated to use the MCP server
3. **Redstring Integration**: Updated to work with MCP instead of fake HTTP APIs

## 🚀 **How to Use**

### **Step 1: Restart Claude Desktop**
1. Close Claude Desktop completely
2. Reopen Claude Desktop
3. It should automatically connect to the Redstring MCP server

### **Step 2: Test the Integration**
1. Open Redstring in your browser
2. Click the brain icon in the **left panel**
3. You should see "MCP Server connected!" message

### **Step 3: Use Claude Desktop with Redstring**
1. In Claude Desktop, look for the **"Search and tools"** icon (slider icon)
2. You should see **Redstring tools** available:
   - `explore_knowledge` - Explore your knowledge graph
   - `create_concept_map` - Create concept maps
   - `collaborative_reasoning` - Engage in collaborative reasoning

### **Step 4: Test the Tools**
Try asking Claude Desktop:
- "Explore my knowledge graph about AI collaboration"
- "Create a concept map for cognitive systems"
- "Let's do collaborative reasoning about knowledge graphs"

## 🔧 **How It Works**

1. **Claude Desktop** starts the Redstring MCP server via STDIO
2. **MCP Server** provides tools that Claude can call
3. **Redstring** receives tool calls and processes them
4. **Claude** gets responses and formulates natural language replies

## 🎨 **Available MCP Tools**

### **explore_knowledge**
- **Purpose**: Explore and analyze the knowledge graph
- **Parameters**: 
  - `query`: The concept to explore
  - `maxDepth`: Maximum exploration depth (optional)
- **Returns**: Analysis of graph structure and recommendations

### **create_concept_map**
- **Purpose**: Create concept maps from the knowledge graph
- **Parameters**:
  - `domain`: The domain/topic for the map
  - `includeRelationships`: Include relationship types (optional)
- **Returns**: Structured concept map with relationships

### **collaborative_reasoning**
- **Purpose**: Engage in collaborative reasoning about the graph
- **Parameters**:
  - `topic`: The topic for reasoning
  - `reasoningMode`: Type of reasoning (exploratory/analytical/creative)
- **Returns**: Collaborative analysis and questions

## 🐛 **Troubleshooting**

### **If Claude Desktop doesn't show the tools:**
1. Check that Claude Desktop is updated to the latest version
2. Verify the config file is saved and Claude Desktop was restarted
3. Check Claude Desktop logs: `~/Library/Logs/Claude/mcp*.log`

### **If the MCP server fails to start:**
1. Make sure Node.js is installed and working
2. Check that the MCP SDK is installed: `npm install @modelcontextprotocol/sdk zod`
3. Test the server manually: `node redstring-mcp-server.js`

### **If tools don't work:**
1. Check the browser console for errors
2. Verify the MCP server is running
3. Check Claude Desktop logs for tool execution errors

## 🎉 **Success Indicators**

- **Claude Desktop** shows the tools slider icon
- **Redstring** shows "MCP Server connected!" 
- **Tool calls** work and return meaningful responses
- **No more "undefined"** responses

## 🔄 **Next Steps**

1. **Test the integration** - Try all the available tools
2. **Expand the tools** - Add more sophisticated graph analysis
3. **Real-time integration** - Connect the MCP server to actual Redstring data
4. **Advanced features** - Add pattern recognition, graph visualization, etc.

The integration is now **properly built** using the official MCP specification! 🧠✨ 