/**
 * search - Unified search for nodes or connections
 * Routes to searchNodes or searchConnections based on searchType parameter.
 */

import { searchNodes } from './searchNodes.js';
import { searchConnections } from './searchConnections.js';

export async function search(args, graphState, cid, ensureSchedulerStarted) {
  const { searchType = 'nodes', ...rest } = args;

  if (searchType === 'connections') {
    return searchConnections(rest, graphState, cid, ensureSchedulerStarted);
  }

  return searchNodes(rest, graphState, cid, ensureSchedulerStarted);
}
