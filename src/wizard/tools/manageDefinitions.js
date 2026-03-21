/**
 * manageDefinitions - List or remove definition graphs for a node
 * Routes to listDefinitionGraphs or removeDefinitionGraph based on action parameter.
 */

import { listDefinitionGraphs } from './listDefinitionGraphs.js';
import { removeDefinitionGraph } from './removeDefinitionGraph.js';

export async function manageDefinitions(args, graphState, cid, ensureSchedulerStarted) {
  const { action = 'list', ...rest } = args;

  if (action === 'remove') {
    return removeDefinitionGraph(rest, graphState);
  }

  // Default: list
  return listDefinitionGraphs(rest, graphState);
}
