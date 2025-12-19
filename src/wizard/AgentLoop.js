/**
 * AgentLoop - Main agent runtime loop
 * One LLM conversation that loops until task is complete (max 10 iterations)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callLLM, streamLLM } from './LLMClient.js';
import { buildContext } from './ContextBuilder.js';
import { executeTool, getToolDefinitions } from './tools/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load system prompt
const SYSTEM_PROMPT_PATH = path.join(__dirname, 'prompts', 'system.md');
let SYSTEM_PROMPT = '';
try {
  SYSTEM_PROMPT = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
} catch (error) {
  console.error('[AgentLoop] Failed to load system prompt:', error);
  SYSTEM_PROMPT = 'You are The Wizard, a helpful assistant for building knowledge graphs.';
}

const MAX_ITERATIONS = 10;

/**
 * Run the agent loop
 * @param {string} userMessage - User's message
 * @param {Object} graphState - Current graph state from UI
 * @param {Object} config - LLM config (provider, apiKey, etc.)
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {AsyncGenerator} Yields events: { type, ... }
 */
export async function* runAgent(userMessage, graphState, config = {}, ensureSchedulerStarted) {
  const cid = config.cid || `wizard-${Date.now()}`;
  
  // Build context
  const contextStr = buildContext(graphState);
  const fullSystemPrompt = SYSTEM_PROMPT.replace('{graphName}', graphState.activeGraphId ? (graphState.graphs?.find(g => g.id === graphState.activeGraphId)?.name || 'Unknown') : 'None')
    .replace('{nodeList}', contextStr.includes('Existing Things') ? contextStr.split('Existing Things:')[1]?.split('\n')[0] || '' : '')
    .replace('{edgeList}', ''); // Can be enhanced later

  const messages = [
    { role: 'system', content: fullSystemPrompt + '\n\n' + contextStr },
    { role: 'user', content: userMessage }
  ];

  const tools = getToolDefinitions();

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    try {
      // Call LLM
      const response = await callLLM(messages, tools, config);

      // If no tool calls, LLM decided task is complete
      if (!response.toolCalls || response.toolCalls.length === 0) {
        if (response.content) {
          yield { type: 'response', content: response.content };
        }
        yield { type: 'done', iterations: iteration + 1 };
        return;
      }

      // Execute tools sequentially
      for (const toolCall of response.toolCalls) {
        // Stream tool call event
        yield {
          type: 'tool_call',
          name: toolCall.name,
          args: toolCall.args,
          id: toolCall.id
        };

        try {
          // Execute tool
          const result = await executeTool(
            toolCall.name,
            toolCall.args,
            graphState,
            cid,
            ensureSchedulerStarted
          );

          // Stream tool result event
          yield {
            type: 'tool_result',
            name: toolCall.name,
            result,
            id: toolCall.id
          };

          // Add tool result to conversation for LLM to verify
          messages.push({
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: toolCall.id,
              type: 'function',
              function: {
                name: toolCall.name,
                arguments: JSON.stringify(toolCall.args)
              }
            }]
          });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          });
        } catch (error) {
          // Stream error event
          yield {
            type: 'tool_result',
            name: toolCall.name,
            result: { error: error.message },
            id: toolCall.id
          };

          // Add error to conversation
          messages.push({
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: toolCall.id,
              type: 'function',
              function: {
                name: toolCall.name,
                arguments: JSON.stringify(toolCall.args)
              }
            }]
          });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: error.message })
          });
        }
      }

      // Loop continues - LLM will verify results and decide: more work or respond
    } catch (error) {
      yield { type: 'error', message: error.message };
      yield { type: 'done', iterations: iteration + 1 };
      return;
    }
  }

  // Max iterations reached
  yield { type: 'response', content: 'Reached maximum iterations. Task may be incomplete.' };
  yield { type: 'done', iterations: MAX_ITERATIONS };
}

