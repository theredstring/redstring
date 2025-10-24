# Comprehensive AI Tools for Redstring - First-Class User Experience

## 🎯 Goal: Make AI a First-Class User

Based on analysis of `NodeCanvas.jsx` and `graphStore.jsx`, here's every command an AI would need to act like a human user:

## 📋 **CURRENT TOOLS (Already Implemented)**
- `list_available_graphs` - See all graphs
- `get_active_graph` - Get current graph info
- `open_graph` - Open a graph
- `set_active_graph` - Switch active graph
- `add_node_prototype` - Create new node types
- `add_node_instance` - Add nodes to graphs
- `update_node_prototype` - Modify node type properties (name, description, color)
- `delete_node_instance` - Remove a node from a graph
- `create_edge` - Connect two nodes
- `create_edge_definition` - Define new edge types
- `move_node_instance` - Move a node to new coordinates
- `search_nodes` - Find nodes by name/description

## 🚀 **Tool Call Flow & Logging**

To provide full transparency into the AI's operations, we've implemented comprehensive logging for every step of the tool call process. Here's how it works:

**1. AI Tool Call:**
- The AI decides to call a tool (e.g., `open_graph`).
- **Log:** `[AI] Calling tool: open_graph with args: { graphId: 'Mesa Verde' }`

**2. MCP Server Receives Tool Call:**
- The MCP server receives the tool call from the AI.
- The corresponding tool handler is executed.

**3. Tool Queues Pending Action:**
- The tool queues a pending action for the Redstring bridge.
- **Log:** `✅ Bridge: Queued openGraph action for d876c7c3-ba07-43a3-8aa5-86ab6f9b9ee2`

**4. Bridge Polls for Pending Actions:**
- The `MCPBridge.jsx` component in the Redstring UI polls the MCP server every 2 seconds.
- **Log:** `[Bridge] Pending actions requested - found 1 actions: [ 'openGraph' ]`

**5. Bridge Executes Action:**
- The bridge finds the pending action and executes the corresponding function in the Redstring store.
- **Log:** `MCPBridge: Calling openGraphTab d876c7c3-ba07-43a3-8aa5-86ab6f9b9ee2`

**6. Redstring Store Updates:**
- The store function (`openGraphTab`) is executed, updating the Redstring UI state.
- **Log:** `[Store openGraphTab] Set activeGraphId to: d876c7c3-ba07-43a3-8aa5-86ab6f9b9ee2`

**7. UI Reflects Changes:**
- The Redstring UI re-renders to reflect the new state (e.g., the "Mesa Verde" graph tab appears).

### **HTTP Bridge Endpoints & Logging**

All bridge action endpoints now have standardized logging:

- **`POST /api/bridge/actions/set-active-graph`**
  - **Log:** `[HTTP][POST] /api/bridge/actions/set-active-graph - Request received for graphId: ...`
- **`POST /api/bridge/actions/open-graph-tab`**
  - **Log:** `[HTTP][POST] /api/bridge/actions/open-graph-tab - Request received for graphId: ...`
- **`POST /api/bridge/actions/add-node-prototype`**
  - **Log:** `[HTTP][POST] /api/bridge/actions/add-node-prototype - Request received for name: ...`
- **`POST /api/bridge/actions/add-node-instance`**
  - **Log:** `[HTTP][POST] /api/bridge/actions/add-node-instance - Request received for graphId: ..., prototypeId: ...`
- **`POST /api/bridge/actions/update-node-prototype`**
  - **Log:** `[HTTP][POST] /api/bridge/actions/update-node-prototype - Request received for prototypeId: ...`
- **`POST /api/bridge/actions/delete-node-instance`**
  - **Log:** `[HTTP][POST] /api/bridge/actions/delete-node-instance - Request received for graphId: ..., instanceId: ...`
- **`POST /api/bridge/actions/create-edge`**
  - **Log:** `[HTTP][POST] /api/bridge/actions/create-edge - Request received for graphId: ..., sourceId: ..., targetId: ...`
- **`POST /api/bridge/actions/create-edge-definition`**
  - **Log:** `[HTTP][POST] /api/bridge/actions/create-edge-definition - Request received for name: ...`
- **`POST /api/bridge/actions/move-node-instance`**
  - **Log:** `[HTTP][POST] /api/bridge/actions/move-node-instance - Request received for graphId: ..., instanceId: ...`

This detailed logging will make it much easier to debug any issues with the AI tool calls and understand the complete flow from AI decision to UI update.
