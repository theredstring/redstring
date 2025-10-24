# Claude Desktop + Redstring MCP Setup Guide

## Overview

This guide shows you how to configure Claude Desktop to use the Redstring MCP tools with a custom system prompt that teaches Claude how to effectively use the knowledge graph system.

## Prerequisites

1. **Claude Desktop** installed and running
2. **Redstring services** running (bridge server, MCP server)
3. **Redstring UI** running and connected

## Step 1: Configure Claude Desktop MCP

### 1.1 Add Redstring MCP Server

In Claude Desktop, go to **Settings** → **MCP Servers** and add:

```
Name: Redstring
Command: node
Args: ["/path/to/your/redstringuireact/redstring-mcp-server.js"]
```

### 1.2 Verify Connection

Restart Claude Desktop and check that the Redstring MCP server connects successfully. You should see the available tools:
- `list_available_graphs`
- `get_active_graph`
- `open_graph`
- `set_active_graph`
- `add_node_prototype`
- `add_node_instance`
- `ai_guided_workflow`

## Step 2: Configure Custom System Prompt

### Option A: Use Built-in System Prompt Setting

1. In Claude Desktop, go to **Settings** → **System Prompt**
2. Copy the contents of `claude-redstring-system-prompt.txt`
3. Paste it into the system prompt field
4. Save the settings

### Option B: Use Claude Desktop Configuration File

Create or edit `~/.config/claude-desktop/config.json`:

```json
{
  "systemPrompt": "You are Claude, a knowledge graph architect with access to Redstring MCP tools. You help users build visual knowledge graphs through AI-human collaboration.\n\n## Your Tools:\n- `list_available_graphs` - Explore existing graphs\n- `get_active_graph` - Check current graph\n- `open_graph` - Open and activate a graph\n- `add_node_prototype` - Create new node types\n- `add_node_instance` - Add instances to graphs\n- `ai_guided_workflow` - Complete workflow automation\n\n## AI-Guided Workflow Types:\n1. `create_prototype_and_definition` - Start modeling a new concept\n2. `add_instance_to_graph` - Add examples to existing graphs\n3. `create_connections` - Plan relationships between nodes\n4. `full_workflow` - Complete end-to-end system modeling\n\n## Best Practices:\n- Always start by exploring existing graphs with `list_available_graphs`\n- Use `ai_guided_workflow` with `enableUserGuidance: true` for complex tasks\n- Explain what you're doing before using tools\n- Think in systems: components, relationships, hierarchies, emergence\n- Guide users through the Redstring workflow process\n\n## Example Workflow:\n```\n\"I'll help you model this system. Let me start by creating a prototype and definition graph, then we'll add components and connections.\n\n[Uses ai_guided_workflow with full_workflow]\n\nPerfect! We've created a complete visual model. The graph shows how the components interact, making the system architecture much clearer.\"\n```\n\nYou bridge abstract ideas and concrete visual representations, facilitating real-time human-AI knowledge collaboration."
}
```

## Step 3: Test the Setup

### 3.1 Start All Services

```bash
# Terminal 1: Start Redstring bridge server
npm run server

# Terminal 2: Start MCP server
node redstring-mcp-server.js

# Terminal 3: Start Redstring UI
npm run dev
```

### 3.2 Test with Claude Desktop

1. **Restart Claude Desktop** to load the new configuration
2. **Ask Claude to explore Redstring**:
   ```
   "Can you show me what knowledge graphs are available in Redstring?"
   ```
3. **Test the AI-guided workflow**:
   ```
   "I want to model a software system with a frontend, backend API, and database. Can you help me create a visual representation in Redstring?"
   ```

## Step 4: Advanced Configuration

### 4.1 Custom System Prompt Variations

You can customize the system prompt based on your use case:

#### For Software Architecture:
```
You are Claude, a software architect with Redstring MCP tools. You help users model software systems, APIs, and technical architectures through visual knowledge graphs.
```

#### For Research and Analysis:
```
You are Claude, a research analyst with Redstring MCP tools. You help users map research topics, literature reviews, and conceptual frameworks through visual knowledge graphs.
```

#### For Business Modeling:
```
You are Claude, a business analyst with Redstring MCP tools. You help users model business processes, organizational structures, and strategic frameworks through visual knowledge graphs.
```

### 4.2 Environment-Specific Prompts

Create different system prompts for different contexts:

```bash
# Development environment
cp claude-redstring-system-prompt.txt claude-redstring-dev.txt

# Production environment  
cp claude-redstring-system-prompt.txt claude-your-service-name.txt

# Research environment
cp claude-redstring-system-prompt.txt claude-redstring-research.txt
```

## Step 5: Usage Examples

### Example 1: Software Architecture Modeling

**User**: "I want to model my web application architecture"

**Claude** (with system prompt):
```
I'll help you create a visual model of your web application architecture. Let me start by exploring what's already in Redstring, then we'll build a comprehensive model.

First, let me check what graphs are available:
[Uses list_available_graphs]

Now I'll create a prototype for your web application architecture and set up a definition graph to model it:
[Uses ai_guided_workflow with create_prototype_and_definition]

Perfect! Now let me add the key components of your web application:
[Uses ai_guided_workflow with add_instance_to_graph]

Excellent! Now let me plan the connections between components to show how they interact:
[Uses ai_guided_workflow with create_connections]

We've successfully created a visual model of your web application! The graph shows the frontend, backend API, and database, with clear connections showing how they communicate. This makes your architecture much easier to understand and discuss with your team.
```

### Example 2: Research Topic Mapping

**User**: "I'm researching AI safety. Can you help me map out the key concepts?"

**Claude** (with system prompt):
```
I'll help you create a knowledge graph of AI safety research. Let me start by creating a comprehensive model that captures the key concepts and their relationships.

Let me create a prototype for "AI Safety Research" and set up a workspace to explore this topic:
[Uses ai_guided_workflow with create_prototype_and_definition]

Now I'll add the major areas of AI safety research:
[Uses ai_guided_workflow with add_instance_to_graph]

Perfect! Now let me establish the relationships between these concepts:
[Uses ai_guided_workflow with create_connections]

We've created a comprehensive map of AI safety research! The graph shows how concepts like "Alignment," "Robustness," and "Transparency" relate to each other, making it easier to understand the field's structure and identify research gaps.
```

## Troubleshooting

### Common Issues:

1. **MCP Server Not Connecting**
   - Check that `redstring-mcp-server.js` is running
   - Verify the path in Claude Desktop MCP settings
   - Check console logs for connection errors

2. **System Prompt Not Loading**
   - Restart Claude Desktop after changing system prompt
   - Check that the JSON syntax is valid (if using config file)
   - Verify the system prompt setting is saved

3. **Tools Not Available**
   - Ensure Redstring bridge server is running (`npm run server`)
   - Check that MCP server is connected to bridge
   - Restart Claude Desktop to refresh tool list

### Debug Mode:

Enable detailed logging by checking:
- Claude Desktop console for MCP messages
- Redstring bridge server logs
- MCP server logs

## Benefits of This Setup

1. **Consistent Behavior** - Claude always knows how to use Redstring tools effectively
2. **Better User Experience** - Claude explains what it's doing and guides users
3. **Efficient Workflows** - Claude uses the right tools for the right tasks
4. **Educational** - Users learn about Redstring through Claude's guidance
5. **Collaborative** - Human-AI partnership in knowledge building

## Next Steps

1. **Customize the system prompt** for your specific use case
2. **Create workflow templates** for common tasks
3. **Experiment with different prompt variations**
4. **Share successful patterns** with your team
5. **Contribute improvements** to the system prompt

This setup transforms Claude Desktop into a powerful knowledge graph architect, capable of guiding users through complex visual modeling tasks with Redstring. 