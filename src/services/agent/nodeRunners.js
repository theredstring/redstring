/**
 * Node Type Runners - Execute different agent node types
 */

import { callLLM } from './llmCaller.js';

/**
 * Run an executor node (standard LLM prompt)
 */
export async function runExecutor(node, input, workingMemory, apiKey, apiConfig = null) {
  const config = node.agentConfig;
  if (!config?.enabled || !config.prompt) {
    return input; // Pass through if not configured
  }

  const provider = apiConfig?.provider || 'openrouter';
  const endpoint = apiConfig?.endpoint || null;
  const model = apiConfig?.model || null;
  const effectiveApiKey = config.apiKeyOverride || apiKey;

  // Build context from working memory
  const contextEntries = workingMemory.entries();
  const contextString = contextEntries.length > 0
    ? '\n\nCONTEXT:\n' + contextEntries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')
    : '';

  const fullPrompt = `${config.prompt}${contextString}\n\nINPUT: ${JSON.stringify(input, null, 2)}`;

  const response = await callLLM({
    apiKey: effectiveApiKey,
    provider,
    endpoint,
    model,
    systemPrompt: config.prompt,
    userPrompt: JSON.stringify(input, null, 2),
    maxTokens: config.maxTokens || 2000,
    temperature: config.temperature ?? 0.7
  });

  // Try to parse as JSON if outputSchema suggests it
  if (config.outputSchema?.type === 'json' || config.outputSchema?.type === 'object') {
    try {
      return JSON.parse(response);
    } catch {
      // If parsing fails, return raw text
      return response;
    }
  }

  return response;
}

/**
 * Run a router node (routes to different agents based on input)
 */
export async function runRouter(node, input, workingMemory, apiKey, apiConfig = null) {
  const config = node.agentConfig;
  if (!config?.enabled || !config.prompt) {
    return { route: null, input };
  }

  const provider = apiConfig?.provider || 'openrouter';
  const endpoint = apiConfig?.endpoint || null;
  const model = apiConfig?.model || null;
  const effectiveApiKey = config.apiKeyOverride || apiKey;

  // Router prompt should return JSON with route decision
  const routerPrompt = `${config.prompt}\n\nAnalyze the input and return JSON with "route" field matching one of these routes: ${Object.keys(config.routes || {}).join(', ')}`;

  const response = await callLLM({
    apiKey: effectiveApiKey,
    provider,
    endpoint,
    model,
    systemPrompt: routerPrompt,
    userPrompt: JSON.stringify(input, null, 2),
    maxTokens: config.maxTokens || 500,
    temperature: config.temperature ?? 0.3 // Lower temperature for routing decisions
  });

  try {
    const decision = JSON.parse(response);
    const route = decision.route;
    
    if (config.routes && config.routes[route]) {
      return { route, targetNodeId: config.routes[route], input };
    }
    
    // Default route if specified
    if (config.defaultRoute) {
      return { route: 'default', targetNodeId: config.defaultRoute, input };
    }
    
    return { route: null, input };
  } catch {
    // If parsing fails, try default route
    if (config.defaultRoute) {
      return { route: 'default', targetNodeId: config.defaultRoute, input };
    }
    return { route: null, input };
  }
}

/**
 * Run a validator node (checks constraints)
 */
export async function runValidator(node, input, workingMemory, apiKey, apiConfig = null) {
  const config = node.agentConfig;
  if (!config?.enabled || !config.prompt) {
    return { valid: true, input };
  }

  const provider = apiConfig?.provider || 'openrouter';
  const endpoint = apiConfig?.endpoint || null;
  const model = apiConfig?.model || null;
  const effectiveApiKey = config.apiKeyOverride || apiKey;

  const validatorPrompt = `${config.prompt}\n\nReturn JSON with "valid" (boolean) and "reason" (string) fields.`;

  const response = await callLLM({
    apiKey: effectiveApiKey,
    provider,
    endpoint,
    model,
    systemPrompt: validatorPrompt,
    userPrompt: JSON.stringify(input, null, 2),
    maxTokens: config.maxTokens || 500,
    temperature: config.temperature ?? 0.2 // Very low temperature for validation
  });

  try {
    const result = JSON.parse(response);
    return {
      valid: result.valid !== false,
      reason: result.reason || '',
      input: result.input || input
    };
  } catch {
    // If parsing fails, assume valid (fail open)
    return { valid: true, input, reason: 'Could not parse validator response' };
  }
}

/**
 * Run a transformer node (no LLM, just data transformation)
 */
export function runTransformer(node, input, workingMemory) {
  const config = node.agentConfig;
  if (!config?.enabled) {
    return input;
  }

  // Transformers can have a transform function or use config rules
  if (typeof config.transform === 'function') {
    return config.transform(input, workingMemory);
  }

  // Simple field mapping
  if (config.fieldMapping) {
    const output = {};
    Object.entries(config.fieldMapping).forEach(([outputKey, inputKey]) => {
      output[outputKey] = input[inputKey] ?? null;
    });
    return output;
  }

  // Pass through if no transform defined
  return input;
}

/**
 * Run an aggregator node (combines outputs from multiple agents)
 */
export async function runAggregator(node, input, workingMemory, apiKey, apiConfig = null) {
  const config = node.agentConfig;
  if (!config?.enabled) {
    return input;
  }

  // Aggregator collects outputs from multiple sources
  // Input should be an array of outputs or references to working memory keys
  const sources = Array.isArray(input) ? input : [input];
  
  if (config.aggregationStrategy === 'merge') {
    // Simple merge
    return Object.assign({}, ...sources);
  } else if (config.aggregationStrategy === 'llm') {
    // Use LLM to synthesize
    const provider = apiConfig?.provider || 'openrouter';
    const endpoint = apiConfig?.endpoint || null;
    const model = apiConfig?.model || null;
    const effectiveApiKey = config.apiKeyOverride || apiKey;

    const aggregationPrompt = config.prompt || 'Combine these outputs into a single coherent result.';
    
    const response = await callLLM({
      apiKey: effectiveApiKey,
      provider,
      endpoint,
      model,
      systemPrompt: aggregationPrompt,
      userPrompt: JSON.stringify(sources, null, 2),
      maxTokens: config.maxTokens || 2000,
      temperature: config.temperature ?? 0.7
    });

    try {
      return JSON.parse(response);
    } catch {
      return response;
    }
  } else {
    // Default: return array
    return sources;
  }
}

/**
 * Run a sensor node (watches for events/changes)
 */
export async function runSensor(node, input, workingMemory) {
  const config = node.agentConfig;
  if (!config?.enabled) {
    return null;
  }

  // Sensors subscribe to events and emit when triggered
  // This is handled by the executor's event system
  // Sensor nodes typically don't produce output, they trigger other nodes
  
  // Store observation in working memory
  const observationKey = `${node.name}.observation`;
  workingMemory.set(observationKey, input, node.id);
  
  // Emit sensor event
  workingMemory.emit(`sensor:${node.name}`, input);
  
  return { observed: true, data: input };
}



