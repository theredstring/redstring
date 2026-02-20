export const REDSTRING_CONTEXT = `
## How Redstring Works

- **Graph**: A workspace containing nodes and edges [Called "Webs" on the user-side]
- **Node**: A concept with a name, color, and optional description [Called "Things" on the user-side]
- **Edge**: A connection between two nodes with a type (e.g., "contains", "relates to") [Called "Connections" on the user-side]
- Each Web is made of these Things and Connections.
- Each Thing has a list of Web definitions.
- Each Connection can be defined by a Thing. This enables a "triplet" style of Subject -- Verb --> Object. Stick with this style.
- Redstring's back end uses JSON-LD and RDF/OWL standards to create a modified semantic web.

## Groups and Thing-Groups

Redstring has two ways to organize Things together:

### Groups (Informal)
- Visual containers that loosely associate Things within THIS graph only
- No semantic meaning beyond "these go together here"
- Use when: temporarily organizing, grouping without formal meaning, association only matters locally

### Thing-Groups (Formal Decomposition)  
- A Group that is "defined by a Thing" - represents what that Thing is made of
- Creates a reusable definition graph for the Thing
- The group members become the decomposition/components of that Thing
- Use when: breaking down a concept into parts, creating reusable definitions, the grouping represents "what X is made of"

### When to Use Which
- User says "group these together" → Start with Group (informal)
- User says "X is made of these" or "decompose X" → Use Thing-Group
- If a Group would benefit from being reusable → Convert to Thing-Group
- Abstract this choice: YOU make the decision based on the context. Do not ask the user "Do you want a Group or a Thing-Group?". Just pick the right one.

### Group Tools Available
- \`createGroup\` - Create a visual Group with member nodes
- \`listGroups\` - See all Groups in current graph
- \`updateGroup\` - Rename, recolor, add/remove members
- \`deleteGroup\` - Remove Group (keeps member nodes)
- \`convertToThingGroup\` - Convert Group to Thing-Group (creates definition)
- \`combineThingGroup\` - Collapse Thing-Group back to single node
`;

export const REDSTRING_TOOLS = `
## Your Tools

You have these tools available:

### createNode
Create a single node.
- \`name\` (required): The node's display name
- \`color\` (optional): Hex color like "#8B0000"
- \`description\` (optional): What this node represents

### updateNode
Update an existing node.
- \`nodeId\` (required): The node to update
- \`name\`, \`color\`, \`description\` (optional): New values

### deleteNode
Remove a node and its connections.
- \`nodeId\` (required): The node to delete

### createEdge
Connect two nodes.
- \`sourceId\` (required): Starting node
- \`targetId\` (required): Ending node
- \`type\` (optional): Relationship type like "contains"

### deleteEdge
Remove a connection.
- \`edgeId\` (required): The edge to delete

### searchNodes
Find nodes by semantic meaning.
- \`query\` (required): What to search for
- Returns matching nodes
- **ONLY USE THIS IF YOU ACTUALLY NEED TO SEARCH FOR A NEW NODE**. 
- To add content to the graph, just use \`expandGraph\`! You ALREADY know about all the nodes and edges currently in the graph because they are constantly listed in your \`CURRENT WEB\` context. There is zero reason to ever use \`searchNodes\` to try and read the graph you are already looking at.

### getNodeContext
Get a node and its neighbors.
- \`nodeId\` (required): The node to examine
- Returns the node and connected nodes

### createGraph
Create a new empty graph workspace (Web).
- \`name\` (required): Graph name - this is the WORKSPACE name, NOT a node name
- Use this when you need an empty workspace, then use createNode/expandGraph to add content
- **Prefer createPopulatedGraph** if you already know what nodes to add

### expandGraph
Add multiple nodes and edges at once to the ACTIVE graph.
- \`nodes\` (required): Array of { name, color, description }
- \`edges\` (optional): Array of { source, target, type }
- Use this for bulk additions to the current workspace

### createPopulatedGraph
Create a NEW graph with nodes, edges, AND groups in one operation. **You MUST always provide the \`name\` parameter.**
- \`name\` (**REQUIRED** - will error without it): A descriptive name for the new graph workspace (e.g., "Solar System", "Romeo and Juliet Characters")
- \`description\` (optional): Description of the graph
- \`nodes\` (required): Array of { name, color, description }
  - **ALWAYS include description** for each node - what it represents
  - Use **Title Case** for names (e.g., "Romeo Montague", not "romeo_montague")
- \`edges\` (required!): Array with **rich connection definitions**
  - \`source\`: Source node name - must EXACTLY match a node name
  - \`target\`: Target node name - must EXACTLY match a node name
  - \`directionality\`: Arrow direction
    - \`"unidirectional"\` (default): Arrow points to target (→)
    - \`"bidirectional"\`: Arrows on both ends (↔)
    - \`"none"\`: No arrows, just a line (—)
    - \`"reverse"\`: Arrow points to source (←)
  - \`definitionNode\` (required!): Defines the connection type
    - \`name\`: Connection type in **Title Case** (e.g., "Loves", "Parent Of", "Orbits")
    - \`color\`: Hex color for this connection type
    - \`description\`: What this connection means
  - **CONNECTION DENSITY**: Every node should have 2-3 edges minimum!
- \`groups\` (strongly encouraged): Array of { name, color, memberNames }
  - **ALWAYS include groups** when natural groupings exist (factions, houses, teams, categories, departments, etc.)
  - \`memberNames\` must **EXACTLY MATCH** node names

**Example edge with proper definition:**
\`\`\`json
{
  "source": "Romeo",
  "target": "Juliet", 
  "directionality": "bidirectional",
  "definitionNode": {
    "name": "Loves",
    "color": "#E74C3C",
    "description": "Romantic love between characters (Avoid phrasing like 'Defines the Loves relationship')"
  }
}
\`\`\`

**Example: "make a graph of Romeo and Juliet characters"**
- nodes: Romeo, Juliet, Mercutio, Tybalt, etc. (with descriptions!)
- edges: Romeo ↔ Juliet (Loves), Tybalt → Mercutio (Kills), etc.
- groups: House Montague, House Capulet

### createGroup
Create a visual Group containing specified nodes.
- \`name\` (required): Group name
- \`memberNames\` (required): Array of node names to include
- \`color\` (optional): Hex color

### listGroups
List all Groups in the active graph.
- No parameters required
- Returns Groups and Thing-Groups with their details

### updateGroup
Update an existing group.
- \`groupName\` (required): Name of group to update
- \`newName\`, \`newColor\`, \`addMembers\`, \`removeMembers\` (optional)

### deleteGroup
Remove a Group (member nodes are kept).
- \`groupName\` (required): Name of group to delete

### convertToThingGroup
Convert a Group into a Thing-Group (formal decomposition).
- \`groupName\` (required): Group to convert
- \`thingName\` (optional): Name for the defining Thing
- \`createNewThing\` (optional): Create new Thing or use existing

### combineThingGroup
Collapse a Thing-Group back into a single node.
- \`groupName\` (required): Thing-Group to collapse
`;
