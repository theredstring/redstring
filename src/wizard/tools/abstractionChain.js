/**
 * abstractionChain - Read or edit a node's abstraction chains
 * Routes to readAbstractionChain or editAbstractionChain based on action parameter.
 */

import { readAbstractionChain } from './readAbstractionChain.js';
import { editAbstractionChain } from './editAbstractionChain.js';
import { buildAbstractionChain } from './buildAbstractionChain.js';

export async function abstractionChain(args, graphState, cid, ensureSchedulerStarted) {
  const { action = 'read', ...rest } = args;

  // "build" lays down a whole ladder from a list of names in one call — the path
  // to prefer. "add"/"remove" edit a single level of an existing chain.
  if (action === 'build') {
    return buildAbstractionChain(rest, graphState);
  }

  if (action === 'add' || action === 'remove') {
    return editAbstractionChain(
      { ...rest, editAction: action },
      graphState
    );
  }

  // Default: read
  return readAbstractionChain(rest, graphState);
}
