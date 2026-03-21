/**
 * abstractionChain - Read or edit a node's abstraction chains
 * Routes to readAbstractionChain or editAbstractionChain based on action parameter.
 */

import { readAbstractionChain } from './readAbstractionChain.js';
import { editAbstractionChain } from './editAbstractionChain.js';

export async function abstractionChain(args, graphState, cid, ensureSchedulerStarted) {
  const { action = 'read', ...rest } = args;

  if (action === 'add' || action === 'remove') {
    return editAbstractionChain(
      { ...rest, editAction: action },
      graphState
    );
  }

  // Default: read
  return readAbstractionChain(rest, graphState);
}
