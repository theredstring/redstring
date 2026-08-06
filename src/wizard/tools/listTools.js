/**
 * listTools - Returns a catalog of ALL available tools organized by capability,
 * using Redstring's Things/Webs/Connections nomenclature.
 * Includes tools that may not be in the current turn's selection.
 *
 * Side effect: sets graphState._unlockAllTools = true so that ALL tools
 * become available in subsequent iterations. This lets the LLM discover
 * capabilities via cheap text (the catalog) rather than expensive schemas.
 */

import { getToolDefinitions } from './schemas.js';

const TOOL_CATALOG = `# Full Tool Catalog

After calling listTools, ALL tools below become available for the rest of this turn. Params marked with * are required; others are optional.

Every node-creating tool also accepts an optional per-node \`size\` ("extra-small" | "small" | "medium" | "large" | "extra-large"). It defaults to "medium" — omit it unless a node's real physical scale or its importance in the Web justifies standing out.

## Things (Nodes)
- **createNode**(name*, color, description, size, targetGraphId) — Create a single Thing
- **updateNode**(nodeName*, updates: {name, color, description, imageSrc}, targetGraphId) — Update a Thing
- **setNodeSize**(nodeName*, size*, targetGraphId) — Resize one Thing on the canvas: "extra-small" | "small" | "medium" (default) | "large" | "extra-large"
- **deleteNode**(nodeName*, targetGraphId) — Remove a Thing
- **selectNode**(nodeName*) — Highlight a Thing for the user
- **setNodeType**(nodeName*, typeName*, typeColor, typeDescription) — Assign a type/category
- **inspectPrototype**(nodeName*) — View full prototype data (definitions, types, metadata)
- **enrichFromWikipedia**(nodeName*, overwriteDescription) — Pull Wikipedia description and image
- **getNodeContext**(nodeName*) — Get connections, groups, and compositional context

## Webs (Graphs)
- **createGraph**(name*, color, description) — Create an empty Web
- **createPopulatedGraph**(name*, description*, nodes[{name,color,description,type,size}]*, edges[{source,target,definitionNode}]*, groups[{name,color,memberNames}], color, enrich, overwriteDescription) — Create a full Web with auto-layout
- **expandGraph**(nodes[], edges[], groups[], targetGraphId, enrich) — Add to an existing Web
- **populateDefinitionGraph**(nodeName*, nodes*, edges*, groups, description, color, enrich) — Build a Thing's internal definition Web
- **readGraph**(targetGraphId) — Read the active Web's state. Call with NO args for active graph
- **sketchGraph**(name*, nodes[strings]*, edges[strings]*) — Validate structure before building
- **switchToGraph**(nodeName* or graphName*) — Navigate to a different Web
- **themeGraph**(palette*, targetGraphId) — Apply a color palette theme
- **mergeGraphs**(sourceGraphName*, targetGraphName*) — Merge two Webs
- **inspectWorkspace**() — View all Webs, Things, and relationships

## Connections (Edges)
- **createEdge**(sourceName*, targetName*, definitionNode:{name,description}*, targetGraphId) — Add a Connection
- **updateEdge**(sourceName*, targetName*, edgeName*, updates:{definitionNode,directionality}) — Modify a Connection
- **deleteEdge**(sourceName*, targetName*, edgeName*, targetGraphId) — Remove a Connection
- **replaceEdges**(edges[{source,target,oldEdgeName,newDefinitionNode}]*, targetGraphId) — Bulk-replace Connections

## Groups & Composition
- **buildComposition**(layers[{name*,display,definition|use}]*, nodes[], edges[], groups[], targetGraphId) — Build nested node-group LAYERS in one call. A layer is a Thing + the Web inside it, optionally spread open. Members go inside definition.nodes, never at the parent level. use:"Existing Thing" invokes an existing Web. THE way to create node-groups.
- **createGroup**(name*, color, memberNames[], targetGraphId) — Create a plain visual Group (loose clustering, no Web inside)
- **updateGroup**(name*, updates:{name,color,memberNames}, targetGraphId) — Modify a Group
- **deleteGroup**(name*, targetGraphId) — Remove a Group
- **thingGroup**(groupName*, nodeName*, targetGraphId) — Convert an EXISTING plain Group into a node-group (for new composition, use buildComposition)
- **condenseToNode**(nodeNames[]*, newNodeName*, description, color, targetGraphId) — Package Things into a new Thing with definition Web
- **decomposeNode**(nodeName*, targetGraphId) — Unpack a Thing's definition into current Web
- **manageDefinitions**(nodeName*, action*:"add"|"remove"|"setActive", definitionGraphId) — Manage definition Webs
- **abstractionChain**(nodeName*, action*:"read"|"add"|"remove", dimension, entries[]) — Abstraction spectrum (Dog → Mammal → Animal)

## Planning & Interaction
- **planTask**(steps[{description,status,substeps}]*) — Create/update a multi-step plan
- **askMultipleChoice**(question*, options[]*) — Ask the user a question
- **search**(query*) — Search across all Things and Webs
- **findDuplicates**(threshold) — Find potential duplicate Things
- **mergeNodes**(sourceNodeName*, targetNodeName*) — Merge duplicates, preserving Connections
- **listTools**() — Show this catalog and unlock all tools

## Semantic Web & Knowledge Discovery
- **discoverOrbit**(query*, endpoint, maxResults) — Discover related entities via semantic web
- **semanticSearch**(query*, endpoint, maxResults) — Search semantic web for entities
- **materializeSemanticEntities**(entities[]*, connections[], targetGraphId) — Convert semantic entities to native Things
- **importKnowledgeCluster**(seedUri*, maxDepth, maxNodes, endpoint) — BFS crawl linked-data relationships
- **querySparql**(query*, endpoint) — Execute raw SPARQL query

## Tabular Data Import
- **analyzeTabularData**(fileIndex) — Analyze uploaded tabular data structure
- **importTabularAsGraph**(graphName*, description*, dataShape*, mapping:{nodeNameColumn,groupByColumn,...}*, maxNodes, enrich) — Convert tabular data to a Web`;

export function listTools(args, graphState) {
  const allToolNames = getToolDefinitions().map(t => t.name);

  // Unlock all tools for subsequent iterations
  if (graphState) {
    graphState._unlockAllTools = true;
  }

  return {
    catalog: TOOL_CATALOG,
    totalTools: allToolNames.length,
    allToolNames,
    unlocked: true
  };
}
