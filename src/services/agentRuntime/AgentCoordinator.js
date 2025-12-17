// AgentCoordinator: Orchestrates plan → execute → observe → (optional) continue
// This is the main entry point for the agent runtime

import { plan } from './Planner.js';
import { execute } from './Executor.js';

/**
 * AgentCoordinator: Main orchestrator for the agent runtime
 */
export class AgentCoordinator {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.executionTracer = options.executionTracer || null;
    this.ensureSchedulerStarted = options.ensureSchedulerStarted || null;
    this.bridgeStoreData = options.bridgeStoreData || null;
    this.plannerPrompt = options.plannerPrompt || null;
  }

  /**
   * Handle a user request: plan → execute → return result
   * @param {Object} request
   * @param {string} request.message - User message
   * @param {Object} request.context - Context (activeGraph, graphs, nodePrototypes, conversationHistory, apiConfig)
   * @param {string} request.apiKey - API key for LLM
   * @param {string} request.cid - Conversation ID
   * @returns {Promise<Object>} { success, response, toolCalls, goalId, cid }
   */
  async handle(request) {
    const { message, context = {}, apiKey, cid } = request;

    if (!apiKey) {
      return {
        success: false,
        error: 'No API key configured. Please click the key icon in the top-right corner to set up your OpenRouter or Anthropic API key before using the Wizard.',
        cid
      };
    }

    try {
      // Step 1: Plan
      const planned = await plan({
        message,
        context: {
          ...context,
          plannerPrompt: this.plannerPrompt || context.plannerPrompt
        },
        bridgeStoreData: this.bridgeStoreData,
        apiKey,
        logger: this.logger,
        executionTracer: this.executionTracer,
        cid
      });

      // Step 2: Execute (if not QA)
      if (planned.intent === 'qa') {
        return {
          success: true,
          response: planned.response || "I'm here to help you create knowledge graphs. What would you like to map?",
          toolCalls: [],
          cid
        };
      }

      // Step 3: Execute plan
      const executionResult = execute(
        planned,
        {
          activeGraphId: context.activeGraphId,
          graphId: context.activeGraphId,
          graphs: context.graphs || this.bridgeStoreData?.graphs || [],
          nodePrototypes: context.nodePrototypes || this.bridgeStoreData?.nodePrototypes || [],
          edges: this.bridgeStoreData?.edges || {}
        },
        cid,
        this.ensureSchedulerStarted
      );

      return {
        success: true,
        response: executionResult.response || planned.response,
        toolCalls: executionResult.toolCalls || [],
        goalId: executionResult.goalId || null,
        cid
      };
    } catch (error) {
      this.logger.error('[AgentCoordinator] Error handling request:', error);
      return {
        success: false,
        error: error.message || String(error),
        cid
      };
    }
  }
}

