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
let SYSTEM_PROMPT = 'You are The Wizard, a helpful assistant for building knowledge graphs.';
try {
  const loadedPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
  if (loadedPrompt) {
    SYSTEM_PROMPT = loadedPrompt;
  }
} catch (error) {
  console.error('[AgentLoop] Failed to load system prompt:', error);
  // SYSTEM_PROMPT already has default value
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
  
  // Debug logging for graph context
  const activeGraph = graphState?.graphs?.find(g => g.id === graphState.activeGraphId);
  const instanceCount = activeGraph?.instances 
    ? (Array.isArray(activeGraph.instances) ? activeGraph.instances.length : Object.keys(activeGraph.instances).length)
    : 0;
  console.log('[AgentLoop] Graph context:', {
    activeGraphId: graphState?.activeGraphId,
    activeGraphName: activeGraph?.name,
    instanceCount,
    edgeCount: activeGraph?.edgeIds?.length || 0,
    graphCount: graphState?.graphs?.length || 0,
    contextPreview: contextStr.substring(0, 300)
  });
  
  const systemPrompt = SYSTEM_PROMPT || 'You are The Wizard, a helpful assistant for building knowledge graphs.';
  const fullSystemPrompt = systemPrompt.replace('{graphName}', graphState.activeGraphId ? (graphState.graphs?.find(g => g.id === graphState.activeGraphId)?.name || 'Unknown') : 'None')
    .replace('{nodeList}', contextStr.includes('Existing Things') ? contextStr.split('Existing Things:')[1]?.split('\n')[0] || '' : '')
    .replace('{edgeList}', ''); // Can be enhanced later

  // Build messages array with conversation history
  const conversationHistory = config.conversationHistory || [];
  const historyMessages = conversationHistory
    .filter(msg => msg.content && msg.content.trim()) // Filter out empty messages
    .map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content
    }));
  
  console.log('[AgentLoop] Conversation history:', historyMessages.length, 'messages');
  
  const messages = [
    { role: 'system', content: fullSystemPrompt + '\n\n' + contextStr },
    ...historyMessages, // Include prior conversation for context
    { role: 'user', content: userMessage }
  ];

  const tools = getToolDefinitions();

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    try {
      let iterationContent = '';
      let iterationToolCalls = [];

      // Stream LLM response for this iteration
      // Track what we've yielded to prevent duplicates
      let yieldedChars = 0;
      
      for await (const chunk of streamLLM(messages, tools, config)) {
        if (chunk.type === 'text') {
          // Only yield new content (dedupe in case of stream issues)
          const newContent = chunk.content;
          if (newContent) {
            iterationContent += newContent;
            console.log('[AgentLoop] Yielding text chunk:', JSON.stringify(newContent));
            yield { type: 'response', content: newContent };
          }
        } else if (chunk.type === 'tool_call') {
          iterationToolCalls.push(chunk);
          console.log('[AgentLoop] Yielding tool_call:', chunk.name);
          yield chunk;
        }
      }
      
      console.log('[AgentLoop] Iteration', iteration, 'complete. Content length:', iterationContent.length);

      // Add this iteration's response to history for the next iteration
      if (iterationContent || iterationToolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: iterationContent || null,
          tool_calls: iterationToolCalls.length > 0 ? iterationToolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args)
            }
          })) : undefined
        });
      }

      // If no tool calls, LLM decided task is complete
      if (iterationToolCalls.length === 0) {
        yield { type: 'done', iterations: iteration + 1 };
        return;
      }

      // Execute tools sequentially
      for (const toolCall of iterationToolCalls) {
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
