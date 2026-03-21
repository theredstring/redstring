/**
 * inspectPrototype - Get prototype details and optionally find all instances
 * Merges getPrototype + getInstancesOfPrototype into one tool.
 */

import { getPrototype } from './getPrototype.js';
import { getInstancesOfPrototype } from './getInstancesOfPrototype.js';

export async function inspectPrototype(args, graphState, cid, ensureSchedulerStarted) {
  const { includeInstances = false, ...rest } = args;

  const protoResult = await getPrototype(rest, graphState);

  if (!includeInstances) {
    return protoResult;
  }

  // If getPrototype returned an error string, don't try to get instances
  if (typeof protoResult === 'string') {
    return protoResult;
  }

  const instanceResult = await getInstancesOfPrototype(
    { prototypeId: protoResult.id, nodeName: args.nodeName },
    graphState
  );

  return {
    ...protoResult,
    instances: typeof instanceResult === 'string' ? [] : instanceResult.instances,
    totalInstancesFound: typeof instanceResult === 'string' ? 0 : instanceResult.totalInstancesFound
  };
}
