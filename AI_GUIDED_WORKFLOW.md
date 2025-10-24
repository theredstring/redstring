# AI-Guided Workflow for Redstring

## Overview

The AI-Guided Workflow system allows Claude Desktop to walk human users through the complete process of building knowledge graphs in Redstring. This replicates the manual workflow that a human would perform, but with AI guidance and automation.

## What It Does

The AI-guided workflow can perform the equivalent of a human user:

1. **Adding a new node to a network** - Creating a new node prototype
2. **Clicking the pie menu up arrow** - Creating a graph definition for a node prototype
3. **Opening that definition as the active graph** - Making the new definition the active workspace
4. **Adding nodes and connections** - Building out the structure with instances and relationships

## Available Workflow Types

### 1. `create_prototype_and_definition`
Creates a new node prototype and its corresponding graph definition.

**Parameters:**
- `prototypeName` (required): Name for the new prototype
- `prototypeDescription` (optional): Description for the prototype
- `prototypeColor` (optional): Color hex code (default: #4A90E2)
- `enableUserGuidance` (optional): Show step-by-step guidance (default: true)

**Example:**
```json
{
  "workflowType": "create_prototype_and_definition",
  "prototypeName": "AI Workflow Test",
  "prototypeDescription": "Testing the AI-guided workflow system",
  "prototypeColor": "#FF6B6B",
  "enableUserGuidance": true
}
```

### 2. `add_instance_to_graph`
Adds instances of existing prototypes to a specified graph.

**Parameters:**
- `targetGraphId` (optional): Specific graph to add to (default: active graph)
- `instancePositions` (required): Array of instances with positions
- `enableUserGuidance` (optional): Show step-by-step guidance (default: true)

**Example:**
```json
{
  "workflowType": "add_instance_to_graph",
  "targetGraphId": "5ba5b655-2d63-4d21-97a7-55edc17808a0",
  "instancePositions": [
    { "prototypeName": "New Character", "x": 150, "y": 150 },
    { "prototypeName": "New Location", "x": 350, "y": 250 }
  ],
  "enableUserGuidance": true
}
```

### 3. `create_connections`
Creates connections between nodes in a graph.

**Parameters:**
- `targetGraphId` (optional): Specific graph to work in (default: active graph)
- `connections` (required): Array of connections to create
- `enableUserGuidance` (optional): Show step-by-step guidance (default: true)

**Example:**
```json
{
  "workflowType": "create_connections",
  "targetGraphId": "graph-1234567890-abcdef",
  "connections": [
    { "sourceName": "Component A", "targetName": "Component B", "edgeType": "depends_on" },
    { "sourceName": "Component B", "targetName": "Component C", "edgeType": "provides_to" }
  ],
  "enableUserGuidance": true
}
```

### 4. `full_workflow`
Performs the complete workflow: create prototype, definition, add instances, and plan connections.

**Parameters:**
- `prototypeName` (required): Name for the new prototype
- `prototypeDescription` (optional): Description for the prototype
- `prototypeColor` (optional): Color hex code (default: #4A90E2)
- `instancePositions` (optional): Array of instances to create
- `connections` (optional): Array of connections to plan
- `enableUserGuidance` (optional): Show step-by-step guidance (default: true)

**Example:**
```json
{
  "workflowType": "full_workflow",
  "prototypeName": "Complete System",
  "prototypeDescription": "A complete system with multiple components",
  "prototypeColor": "#4ECDC4",
  "instancePositions": [
    { "prototypeName": "Component A", "x": 100, "y": 100 },
    { "prototypeName": "Component B", "x": 300, "y": 100 },
    { "prototypeName": "Component C", "x": 200, "y": 300 }
  ],
  "connections": [
    { "sourceName": "Component A", "targetName": "Component B", "edgeType": "depends_on" },
    { "sourceName": "Component B", "targetName": "Component C", "edgeType": "provides_to" }
  ],
  "enableUserGuidance": true
}
```

## How to Use

### Via Claude Desktop MCP

1. **Connect Claude Desktop** to the Redstring MCP server
2. **Use the `ai_guided_workflow` tool** with your desired parameters
3. **Follow the guidance** as Claude walks you through each step

### Via HTTP API

Make a POST request to the bridge endpoint:

```bash
curl -X POST http://localhost:3001/api/bridge/actions/ai-guided-workflow \
  -H "Content-Type: application/json" \
  -d '{
    "workflowType": "full_workflow",
    "prototypeName": "My System",
    "prototypeDescription": "A system I want to model",
    "instancePositions": [
      {"prototypeName": "Part A", "x": 100, "y": 100},
      {"prototypeName": "Part B", "x": 300, "y": 100}
    ]
  }'
```

### Via Test Script

Run the included test script:

```bash
node test-ai-workflow.js
```

## What Happens During Each Workflow

### Step-by-Step Breakdown

1. **Create Prototype**
   - Creates a new node prototype in the global prototype pool
   - Prototype becomes available for creating instances in any graph
   - Prototype persists to the .redstring file

2. **Create Definition**
   - Creates a new graph that serves as the definition for the prototype
   - This is equivalent to clicking the "up arrow" in the pie menu
   - The new graph is linked to the prototype via `definitionGraphIds`

3. **Open Definition**
   - Opens the new definition graph as the active graph
   - Graph appears as a new tab in the header
   - Graph becomes the current workspace

4. **Add Instances**
   - Adds instances of prototypes to the active graph
   - Each instance has a specific position (x, y coordinates)
   - Instances are immediately visible in the Redstring UI

5. **Create Connections**
   - Plans connections between instances (edge creation coming soon)
   - Reports the planned connections for manual creation

## User Guidance Mode

When `enableUserGuidance` is true, the workflow provides step-by-step explanations:

```
**Step 1:** Create a new node prototype called "AI Workflow Test"
I'm creating a new node prototype called "AI Workflow Test" with description: "Testing the AI-guided workflow system"

**Step 2:** Create a graph definition for the "AI Workflow Test" prototype
Now I'm creating a graph definition for the "AI Workflow Test" prototype. This is like clicking the up arrow in the pie menu to create a new definition.

**Step 3:** Open the new definition graph as the active graph
Opening the new definition graph as the active graph so you can start adding content to it.
```

## Integration with Existing Tools

The AI-guided workflow integrates with all existing MCP tools:

- `list_available_graphs` - See what graphs are available
- `get_active_graph` - Check the current active graph
- `add_node_prototype` - Create individual prototypes
- `add_node_instance` - Add individual instances
- `open_graph` - Open specific graphs
- `set_active_graph` - Set specific graphs as active

## Benefits

1. **Complete Workflow Automation** - Replicates the full human workflow
2. **User Guidance** - Explains each step as it happens
3. **Real Redstring Integration** - Works with actual Redstring data and UI
4. **Flexible** - Can be used for partial workflows or complete systems
5. **Educational** - Helps users understand the Redstring workflow

## Example Use Cases

### 1. Modeling a Software System
```json
{
  "workflowType": "full_workflow",
  "prototypeName": "Software Architecture",
  "prototypeDescription": "A complete software system architecture",
  "instancePositions": [
    {"prototypeName": "Frontend", "x": 100, "y": 100},
    {"prototypeName": "Backend API", "x": 300, "y": 100},
    {"prototypeName": "Database", "x": 500, "y": 100},
    {"prototypeName": "Load Balancer", "x": 200, "y": 300}
  ],
  "connections": [
    {"sourceName": "Frontend", "targetName": "Backend API", "edgeType": "calls"},
    {"sourceName": "Backend API", "targetName": "Database", "edgeType": "queries"},
    {"sourceName": "Load Balancer", "targetName": "Frontend", "edgeType": "routes"}
  ]
}
```

### 2. Character Relationship Mapping
```json
{
  "workflowType": "full_workflow",
  "prototypeName": "Character Network",
  "prototypeDescription": "Character relationships in a story",
  "instancePositions": [
    {"prototypeName": "Protagonist", "x": 200, "y": 200},
    {"prototypeName": "Antagonist", "x": 400, "y": 200},
    {"prototypeName": "Mentor", "x": 100, "y": 100},
    {"prototypeName": "Love Interest", "x": 300, "y": 300}
  ],
  "connections": [
    {"sourceName": "Protagonist", "targetName": "Antagonist", "edgeType": "conflicts_with"},
    {"sourceName": "Mentor", "targetName": "Protagonist", "edgeType": "guides"},
    {"sourceName": "Protagonist", "targetName": "Love Interest", "edgeType": "loves"}
  ]
}
```

## Technical Implementation

The AI-guided workflow is implemented through:

1. **MCP Tool** - `ai_guided_workflow` in `redstring-mcp-server.js`
2. **HTTP Endpoint** - `/api/bridge/actions/ai-guided-workflow` in `server.js`
3. **Bridge Actions** - Integration with existing Redstring store actions
4. **Real-time Updates** - Changes are immediately reflected in the Redstring UI

## Future Enhancements

- **Edge Creation** - Full implementation of connection creation
- **Visual Feedback** - Real-time visual indicators during workflow execution
- **Undo/Redo** - Ability to undo workflow steps
- **Templates** - Pre-defined workflow templates for common use cases
- **Collaboration** - Multi-user workflow execution

## Troubleshooting

### Common Issues

1. **"No active graph" error**
   - Use `open_graph` to open a graph first
   - Or specify a `targetGraphId` in the workflow

2. **"Prototype not found" error**
   - Use `add_node_prototype` to create the prototype first
   - Or use the `full_workflow` type which creates prototypes automatically

3. **"Graph not found" error**
   - Use `list_available_graphs` to see available graphs
   - Use `open_graph` to open the desired graph

### Debug Mode

Enable detailed logging by setting `enableUserGuidance: true` to see step-by-step execution details.

## Conclusion

The AI-guided workflow system provides a powerful way for Claude Desktop to help users build complex knowledge graphs in Redstring. It combines the intelligence of AI with the visual and interactive capabilities of Redstring to create a seamless human-AI collaboration experience. 