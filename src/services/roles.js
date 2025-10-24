// Role-specific prompts and allowlists

export const RolePrompts = {
  planner: `You are the Planner. Decompose the goal into a minimal DAG of tasks aligned to available tools.
Search-first guidance:
- If a request references a graph or concept by name, first resolve it via list_available_graphs and/or search_nodes before any create_* tasks.
- If ambiguity remains after search, insert a clarification task (qa prompt) instead of guessing IDs.
Constraints: Do not execute tools. Output only tasks with dependencies and arguments.`,
  executor: `You are the Executor. Execute exactly one task using only allowed tools. Produce idempotent patches (baseHash, ops). Do not commit.`,
  auditor: `You are the Auditor. Validate patches against schema and policy.
Checks:
- New node/graph creations must be preceded by a search/list step to avoid duplicates unless the goal explicitly requests a new one.
- Graph IDs and prototype IDs must be present and valid for instance/edge operations.
Decide approved/rejected with reasons. Never mutate the graph.`,
  committer: `You are the Committer. Merge only approved patches into the canonical store, resolving conflicts optimistically. Emit applyMutations to UI after commit.`
};

export const ToolAllowlists = {
  planner: ['verify_state', 'list_available_graphs', 'get_active_graph', 'search_nodes'],
  executor: [
    // write-capable tasks executed into patches (Committer is single-writer)
    'create_graph', 'create_node_prototype', 'create_node_instance', 'create_edge',
    // read-only inspection tasks allowed for analysis pipelines
    'verify_state', 'list_available_graphs', 'get_active_graph', 'get_graph_instances', 'identify_patterns'
  ],
  auditor: ['verify_state', 'get_active_graph', 'get_graph_instances', 'search_nodes'],
  committer: []
};


