/**
 * thingGroup - Convert a group to a Thing-Group or collapse one back
 * Routes to convertToThingGroup or combineThingGroup based on action parameter.
 */

import { convertToThingGroup } from './convertToThingGroup.js';
import { combineThingGroup } from './combineThingGroup.js';

export async function thingGroup(args, graphState, cid, ensureSchedulerStarted) {
  const { action = 'convert', ...rest } = args;

  if (action === 'collapse') {
    return combineThingGroup(rest, graphState, cid, ensureSchedulerStarted);
  }

  // Default: convert
  return convertToThingGroup(rest, graphState, cid, ensureSchedulerStarted);
}
