# AI Connection Wizard for Redstring

## 🚀 Quick Start

```bash
# Start Redstring first
npm run dev

# In another terminal, run the AI Connection Wizard
npm run ai-wizard
```

## 🤖 What the Wizard Does

The AI Connection Wizard automates the entire process of connecting Redstring to AI services like Claude Desktop and Tome:

### ✅ Automatic Setup
- **Detects Redstring** - Checks if Redstring is running on localhost:4000
- **Starts Bridge Server** - Launches the HTTP bridge on localhost:3001
- **Starts MCP Server** - Launches the MCP server for AI communication
- **Detects AI Clients** - Finds Claude Desktop, Tome, and other MCP clients
- **Provides Instructions** - Shows exactly how to configure each AI client
- **Monitors Status** - Real-time status of all connections

### 🔧 Manual Steps (One-time setup)
The wizard will guide you through configuring your AI client:

#### For Claude Desktop:
1. Open Claude Desktop
2. Go to Settings > Local MCP Servers
3. Add new server:
   - **Command:** `node`
   - **Args:** `/path/to/redstringuireact/redstring-mcp-server.js`
4. Restart Claude Desktop

#### For Tome:
1. Open Tome
2. Go to Settings > MCP Servers
3. Add new server:
   - **Command:** `node /path/to/redstringuireact/redstring-mcp-server.js`
4. Test the connection

## 📊 Available MCP Tools

Once connected, your AI can use these tools:

- `list_available_graphs` - See all your knowledge graphs
- `get_active_graph` - Get info about the current graph
- `open_graph` - Open a specific graph
- `set_active_graph` - Switch to a different graph
- `add_node_prototype` - Create new node types
- `add_node_instance` - Add nodes to graphs

## 🏗️ Architecture

```
┌─────────────────┐    HTTP POST     ┌─────────────────┐    HTTP GET     ┌─────────────────┐
│   Redstring     │ ────────────────► │   Bridge        │ ────────────────► │   MCP Server    │
│   (Browser)     │                  │   (server.js)   │                  │   (Node.js)     │
│   localhost:4000│                  │   localhost:3001│                  │   (STDIO)       │
└─────────────────┘                  └─────────────────┘                  └─────────────────┘
         │                                    │                                    │
         │                                    │                                    │
         ▼                                    ▼                                    ▼
┌─────────────────┐                  ┌─────────────────┐                  ┌─────────────────┐
│   Zustand       │                  │   Express.js    │                  │   Claude        │
│   Store         │                  │   API Server    │                  │   Desktop       │
│   (React)       │                  │   (Node.js)     │                  │   (MCP Client)  │
└─────────────────┘                  └─────────────────┘                  └─────────────────┘
```

## 🛠️ Troubleshooting

### "Redstring not detected"
- Make sure Redstring is running: `npm run dev`
- Check that it's on localhost:4000

### "Bridge server already running"
- This is normal! The wizard detected an existing bridge
- The wizard will use the existing bridge

### "MCP server startup timeout"
- Check if another MCP server is running
- Kill existing processes: `pkill -f "redstring-mcp-server"`
- Restart the wizard

### "No AI clients detected"
- Install Claude Desktop or Tome
- The wizard will detect them automatically

## 🎯 Production Deployment

For production, you can:

1. **Single Server**: Deploy everything on one server
2. **Docker**: Containerize the entire stack
3. **Microservices**: Split bridge and MCP server into separate services
4. **WebSocket Bridge**: Replace HTTP with WebSockets for real-time updates

## 📝 Scripts

```bash
# Start the wizard
npm run ai-wizard
npm run ai-connect

# Start everything (Redstring + Bridge)
npm run dev:full

# Start just the bridge server
npm run server
```

## 🔄 Workflow

1. **Start Redstring**: `npm run dev`
2. **Run Wizard**: `npm run ai-wizard`
3. **Configure AI Client**: Follow wizard instructions
4. **Start AI Collaboration**: Use MCP tools in your AI client
5. **Monitor**: Watch the real-time status display

The wizard makes the entire AI connection process **one command away**! 🚀 