# Redstring MCP Tools Quick Reference

## 🛠️ Available Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `list_available_graphs` | Explore existing graphs | Start any session, understand what's available |
| `get_active_graph` | Check current graph details | Understand current context |
| `open_graph` | Open and activate a graph | Switch to a specific graph |
| `set_active_graph` | Set already-open graph as active | Change focus within open graphs |
| `add_node_prototype` | Create new node types | Define new concepts/classes |
| `add_node_instance` | Add instances to graphs | Populate graphs with examples |
| `ai_guided_workflow` | Complete workflow automation | Complex tasks, user guidance |

## 🤖 AI-Guided Workflow Types

| Type | Purpose | Use Case |
|------|---------|----------|
| `create_prototype_and_definition` | Start modeling new concept | Beginning a new topic |
| `add_instance_to_graph` | Add examples to existing graph | Expanding current work |
| `create_connections` | Plan relationships | Establishing connections |
| `full_workflow` | Complete end-to-end modeling | Comprehensive system building |

## 📝 System Prompt (Copy This)

```
You are Claude, a knowledge graph architect with access to Redstring MCP tools. You help users build visual knowledge graphs through AI-human collaboration.

## Your Tools:
- `list_available_graphs` - Explore existing graphs
- `get_active_graph` - Check current graph
- `open_graph` - Open and activate a graph
- `add_node_prototype` - Create new node types
- `add_node_instance` - Add instances to graphs
- `ai_guided_workflow` - Complete workflow automation

## AI-Guided Workflow Types:
1. `create_prototype_and_definition` - Start modeling a new concept
2. `add_instance_to_graph` - Add examples to existing graphs
3. `create_connections` - Plan relationships between nodes
4. `full_workflow` - Complete end-to-end system modeling

## Best Practices:
- Always start by exploring existing graphs with `list_available_graphs`
- Use `ai_guided_workflow` with `enableUserGuidance: true` for complex tasks
- Explain what you're doing before using tools
- Think in systems: components, relationships, hierarchies, emergence
- Guide users through the Redstring workflow process

## Example Workflow:
```
"I'll help you model this system. Let me start by creating a prototype and definition graph, then we'll add components and connections.

[Uses ai_guided_workflow with full_workflow]

Perfect! We've created a complete visual model. The graph shows how the components interact, making the system architecture much clearer."
```

You bridge abstract ideas and concrete visual representations, facilitating real-time human-AI knowledge collaboration.
```

## 🚀 Quick Start Commands

### Start Services
```bash
# Terminal 1: Bridge server
npm run server

# Terminal 2: MCP server  
node redstring-mcp-server.js

# Terminal 3: Redstring UI
npm run dev
```

### Test Setup
```bash
# Test AI workflow
node test-ai-workflow.js

# Check bridge status
curl -s http://localhost:3001/api/bridge/state | jq '.graphs | length'
```

## 🎯 Common Patterns

### Pattern 1: New Topic Modeling
```
1. list_available_graphs
2. ai_guided_workflow (create_prototype_and_definition)
3. ai_guided_workflow (add_instance_to_graph)
4. ai_guided_workflow (create_connections)
```

### Pattern 2: Extending Existing Work
```
1. list_available_graphs
2. open_graph (target_graph_id)
3. add_node_instance (prototype_name, position)
4. ai_guided_workflow (create_connections)
```

### Pattern 3: System Architecture
```
1. ai_guided_workflow (full_workflow)
   - prototypeName: "System Name"
   - instancePositions: [components...]
   - connections: [relationships...]
```

## 🔧 Configuration Files

### Claude Desktop MCP Settings
```
Name: Redstring
Command: node
Args: ["/path/to/redstringuireact/redstring-mcp-server.js"]
```

### System Prompt Location
- **Claude Desktop**: Settings → System Prompt
- **Config File**: `~/.config/claude-desktop/config.json`

## 📚 Documentation Files

- `AI_GUIDED_WORKFLOW.md` - Complete workflow documentation
- `CLAUDE_DESKTOP_SETUP.md` - Setup guide
- `REDSTRING_MCP_SYSTEM_PROMPT.md` - Detailed system prompt
- `test-ai-workflow.js` - Test script

## 🎉 Success Indicators

- ✅ MCP server connects to Claude Desktop
- ✅ Tools appear in Claude's tool list
- ✅ `list_available_graphs` returns data
- ✅ `ai_guided_workflow` executes successfully
- ✅ Redstring UI shows new graphs/instances

## 🆘 Troubleshooting

| Issue | Solution |
|-------|----------|
| MCP not connecting | Check server paths, restart Claude Desktop |
| Tools not available | Ensure bridge server running, restart MCP |
| System prompt not loading | Restart Claude Desktop, check JSON syntax |
| Workflow errors | Check bridge logs, verify graph/prototype existence | 