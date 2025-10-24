/**
 * AI Agent for Redstring
 * Provides intelligent, goal-oriented AI behavior that understands the prototype/instance architecture
 */

import toolValidator from './toolValidator.js';
import useGraphStore from "../store/graphStore.jsx";

class CognitiveAgent {
  constructor() {
    this.workingMemory = new Map();
    this.goalStack = [];
    this.currentPlan = null;
    this.executionHistory = [];
    this.errorCount = 0;
    this.maxErrors = 3;
  }

  /**
   * Execute a user goal with intelligent planning
   */
  async executeGoal(goalDescription, context = {}) {
    try {
      this.resetSession();
      
      // Parse the goal into actionable components
      const goal = await this.parseGoal(goalDescription, context);
      this.goalStack.push(goal);
      
      // Create execution plan
      this.currentPlan = await this.planGoal(goal, context);
      
      // Execute the plan with cognitive monitoring
      const result = await this.executePlan(this.currentPlan, context);
      
      return {
        success: true,
        goal: goal,
        plan: this.currentPlan,
        result: result,
        executionHistory: this.executionHistory,
        workingMemory: Object.fromEntries(this.workingMemory)
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        goal: this.goalStack[this.goalStack.length - 1],
        plan: this.currentPlan,
        executionHistory: this.executionHistory,
        recovery: await this.generateRecoveryOptions(error)
      };
    }
  }

  /**
   * Parse natural language goal into structured goal object
   */
  async parseGoal(goalDescription, context) {
    const lowerGoal = goalDescription.toLowerCase();
    
    // Graph exploration goals
    if (lowerGoal.includes('show') || lowerGoal.includes('list') || lowerGoal.includes('explore')) {
      if (lowerGoal.includes('graph')) {
        return {
          type: 'exploration',
          subtype: 'list_graphs',
          description: goalDescription,
          priority: 'high'
        };
      }
      if (lowerGoal.includes('node') || lowerGoal.includes('concept')) {
        return {
          type: 'exploration',
          subtype: 'explore_nodes',
          description: goalDescription,
          priority: 'high',
          searchQuery: this.extractSearchTerms(goalDescription)
        };
      }
    }
    
    // Creation goals
    if (lowerGoal.includes('create') || lowerGoal.includes('add') || lowerGoal.includes('make')) {
      if (lowerGoal.includes('node') || lowerGoal.includes('concept')) {
        return {
          type: 'creation',
          subtype: 'create_concept',
          description: goalDescription,
          priority: 'high',
          entityName: this.extractEntityName(goalDescription),
          position: this.extractPosition(goalDescription, context)
        };
      }
      if (lowerGoal.includes('connection') || lowerGoal.includes('edge') || lowerGoal.includes('relationship')) {
        return {
          type: 'creation',
          subtype: 'create_relationship',
          description: goalDescription,
          priority: 'high',
          relationshipData: this.extractRelationshipData(goalDescription)
        };
      }
    }
    
    // Analysis goals
    if (lowerGoal.includes('analyze') || lowerGoal.includes('find pattern') || lowerGoal.includes('understand')) {
      return {
        type: 'analysis',
        subtype: 'pattern_analysis',
        description: goalDescription,
        priority: 'medium',
        analysisType: this.extractAnalysisType(goalDescription)
      };
    }
    
    // Default to exploration
    return {
      type: 'exploration',
      subtype: 'general_inquiry',
      description: goalDescription,
      priority: 'medium'
    };
  }

  /**
   * Create execution plan for a goal
   */
  async planGoal(goal, context) {
    const plan = {
      goal: goal,
      steps: [],
      expectedOutcome: '',
      fallbackSteps: [],
      requiredContext: []
    };

    switch (goal.type) {
      case 'exploration':
        return this.planExploration(goal, context, plan);
      case 'creation':
        return this.planCreation(goal, context, plan);
      case 'analysis':
        return this.planAnalysis(goal, context, plan);
      default:
        return this.planDefault(goal, context, plan);
    }
  }

  /**
   * Plan exploration goals
   */
  async planExploration(goal, context, plan) {
    // Always start by understanding current state
    plan.steps.push({
      action: 'verify_state',
      args: {},
      purpose: 'Understand current Redstring state',
      required: true
    });

    switch (goal.subtype) {
      case 'list_graphs':
        plan.steps.push({
          action: 'list_available_graphs',
          args: {},
          purpose: 'Get all available graphs',
          required: true
        });
        plan.steps.push({
          action: 'get_active_graph',
          args: {},
          purpose: 'Identify currently active graph',
          required: true
        });
        plan.expectedOutcome = 'User sees complete graph overview with active graph highlighted';
        break;
        
      case 'explore_nodes':
        if (goal.searchQuery) {
          plan.steps.push({
            action: 'search_nodes',
            args: { 
              query: goal.searchQuery,
              search_type: 'both'
            },
            purpose: `Search for nodes matching "${goal.searchQuery}"`,
            required: true
          });
        } else {
          plan.steps.push({
            action: 'get_graph_instances',
            args: {},
            purpose: 'Get all instances in active graph',
            required: true
          });
        }
        plan.expectedOutcome = 'User sees relevant nodes with their relationships';
        break;
    }

    plan.fallbackSteps = [
      {
        action: 'verify_state',
        args: {},
        purpose: 'Fallback: Just show current state if other operations fail'
      }
    ];

    return plan;
  }

  /**
   * Plan creation goals
   */
  async planCreation(goal, context, plan) {
    // Verify state first
    plan.steps.push({
      action: 'verify_state',
      args: {},
      purpose: 'Understand current state before creation',
      required: true
    });

    switch (goal.subtype) {
      case 'create_concept':
        // First create or find appropriate prototype
        plan.steps.push({
          action: 'create_node_prototype',
          args: {
            name: goal.entityName || 'New Concept',
            description: `Created from goal: ${goal.description}`,
            ai_metadata: {
              created_by: 'cognitive_agent',
              goal: goal.description,
              timestamp: new Date().toISOString()
            }
          },
          purpose: 'Create reusable concept prototype',
          required: true
        });

        // Then create instance in active graph
        plan.steps.push({
          action: 'create_node_instance',
          args: {
            prototype_id: '${previous_result.prototype_id}', // Will be filled from previous step
            graph_id: context.activeGraphId,
            x: goal.position?.x || 0,
            y: goal.position?.y || 0
          },
          purpose: 'Place concept instance in active graph',
          required: true,
          dependencies: ['create_node_prototype']
        });

        plan.expectedOutcome = 'New concept created and placed in the graph';
        break;

      case 'create_relationship':
        // This requires more complex planning based on available instances
        plan.steps.push({
          action: 'get_graph_instances',
          args: {},
          purpose: 'Find available instances to connect',
          required: true
        });
        
        plan.steps.push({
          action: 'create_edge',
          args: {
            // Will be determined based on user intent and available instances
            graph_id: context.activeGraphId,
            ai_metadata: {
              created_by: 'cognitive_agent',
              goal: goal.description
            }
          },
          purpose: 'Create relationship between concepts',
          required: true,
          dependencies: ['get_graph_instances']
        });

        plan.expectedOutcome = 'Relationship created between concepts';
        break;
    }

    return plan;
  }

  /**
   * Plan analysis goals
   */
  async planAnalysis(goal, context, plan) {
    plan.steps.push({
      action: 'verify_state',
      args: {},
      purpose: 'Understand current state for analysis',
      required: true
    });

    plan.steps.push({
      action: 'identify_patterns',
      args: {
        pattern_type: goal.analysisType || 'semantic',
        graph_id: context.activeGraphId
      },
      purpose: 'Identify patterns in the knowledge graph',
      required: true
    });

    plan.expectedOutcome = 'Pattern analysis and insights provided';
    return plan;
  }

  /**
   * Execute the plan with cognitive monitoring
   */
  async executePlan(plan, context) {
    const results = [];
    const stepResults = new Map();

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      
      try {
        // Validate step arguments
        const validation = toolValidator.validateToolArgs(step.action, step.args);
        if (!validation.valid) {
          throw new Error(`Step validation failed: ${validation.error}`);
        }

        // Execute the tool
        const result = await this.executeTool(step.action, validation.sanitized, context);
        
        // Store result for dependency resolution
        stepResults.set(step.action, result);
        
        // Update working memory
        this.updateWorkingMemory(step.action, result, step.purpose);
        
        // Log execution
        this.executionHistory.push({
          step: i + 1,
          action: step.action,
          args: validation.sanitized,
          purpose: step.purpose,
          result: result,
          timestamp: new Date().toISOString(),
          success: true
        });

        results.push(result);

        // Check if this step provides critical information for later steps
        if (step.action === 'create_node_prototype' && result.prototype_id) {
          // Update any dependent steps
          this.resolveDependencies(plan.steps, 'create_node_prototype', result);
        }

      } catch (error) {
        this.errorCount++;
        
        this.executionHistory.push({
          step: i + 1,
          action: step.action,
          args: step.args,
          purpose: step.purpose,
          error: error.message,
          timestamp: new Date().toISOString(),
          success: false
        });

        // Try recovery if not too many errors
        if (this.errorCount < this.maxErrors && !step.required) {
          console.warn(`[Cognitive Agent] Step ${step.action} failed, continuing: ${error.message}`);
          continue;
        }

        // If required step fails, try fallback
        if (step.required && plan.fallbackSteps.length > 0) {
          console.log(`[Cognitive Agent] Required step failed, trying fallback`);
          return this.executeFallback(plan.fallbackSteps, context);
        }

        throw error;
      }
    }

    return {
      totalSteps: plan.steps.length,
      successfulSteps: results.length,
      results: results,
      summary: this.generateExecutionSummary(plan, results)
    };
  }

  /**
   * Execute a single tool with proper error handling
   */
  async executeTool(toolName, args, context) {
    // This would call your actual tool execution system
    // For now, return a mock result that matches the expected structure
    switch (toolName) {
      case 'verify_state':
        const state = useGraphStore.getState();
        return {
          graphCount: state.graphs.size,
          activeGraphId: state.activeGraphId,
          nodePrototypeCount: state.nodePrototypes.size,
          timestamp: new Date().toISOString()
        };
        
      case 'list_available_graphs':
        const graphState = useGraphStore.getState();
        return {
          graphs: Array.from(graphState.graphs.values()).map(g => ({
            id: g.id,
            name: g.name,
            description: g.description,
            instanceCount: g.instances?.size || 0
          }))
        };
        
      case 'create_node_prototype':
        // Would call actual store action
        const prototypeId = `proto_${Date.now()}`;
        return {
          prototype_id: prototypeId,
          name: args.name,
          created: true
        };
        
      default:
        throw new Error(`Tool ${toolName} not implemented in cognitive agent`);
    }
  }

  /**
   * Execute fallback plan when main plan fails
   */
  async executeFallback(fallbackSteps, context) {
    console.log('[Cognitive Agent] Executing fallback plan');
    const results = [];
    
    for (const step of fallbackSteps) {
      try {
        const result = await this.executeTool(step.action, step.args || {}, context);
        results.push(result);
        
        this.executionHistory.push({
          step: 'fallback',
          action: step.action,
          args: step.args || {},
          purpose: step.purpose,
          result: result,
          timestamp: new Date().toISOString(),
          success: true
        });
      } catch (error) {
        console.error(`[Cognitive Agent] Fallback step ${step.action} failed:`, error);
        break;
      }
    }
    
    return {
      totalSteps: fallbackSteps.length,
      successfulSteps: results.length,
      results: results,
      summary: `Fallback execution completed with ${results.length} successful steps`
    };
  }

  /**
   * Helper methods for goal parsing
   */
  extractSearchTerms(text) {
    // Simple extraction - could be much more sophisticated
    const words = text.toLowerCase().split(' ');
    const stopWords = ['show', 'me', 'all', 'the', 'list', 'find', 'search'];
    return words.filter(word => !stopWords.includes(word) && word.length > 2).join(' ');
  }

  extractEntityName(text) {
    // Look for quoted strings or capitalize words after "create"/"add"
    const quoted = text.match(/"([^"]+)"/);
    if (quoted) return quoted[1];
    
    const words = text.split(' ');
    const createIndex = words.findIndex(w => ['create', 'add', 'make'].includes(w.toLowerCase()));
    if (createIndex >= 0 && createIndex < words.length - 1) {
      return words.slice(createIndex + 1).join(' ');
    }
    
    return 'New Concept';
  }

  extractPosition(text, context) {
    // Could parse coordinates from text or use smart positioning
    return { x: Math.random() * 400, y: Math.random() * 300 };
  }

  extractRelationshipData(text) {
    // Extract relationship information from text
    return {
      sourceHint: null,
      targetHint: null,
      relationshipType: 'related_to'
    };
  }

  extractAnalysisType(text) {
    if (text.includes('semantic')) return 'semantic';
    if (text.includes('structural')) return 'structural';
    if (text.includes('temporal')) return 'temporal';
    if (text.includes('spatial')) return 'spatial';
    return 'semantic';
  }

  /**
   * Utility methods
   */
  resetSession() {
    this.workingMemory.clear();
    this.goalStack = [];
    this.currentPlan = null;
    this.executionHistory = [];
    this.errorCount = 0;
  }

  updateWorkingMemory(action, result, purpose) {
    this.workingMemory.set(action, {
      result,
      purpose,
      timestamp: new Date().toISOString()
    });
  }

  resolveDependencies(steps, completedAction, result) {
    steps.forEach(step => {
      if (step.dependencies?.includes(completedAction)) {
        // Replace placeholder values with actual results
        Object.keys(step.args).forEach(key => {
          if (typeof step.args[key] === 'string' && step.args[key].includes('${previous_result.')) {
            const field = step.args[key].match(/\$\{previous_result\.(\w+)\}/)?.[1];
            if (field && result[field]) {
              step.args[key] = result[field];
            }
          }
        });
      }
    });
  }

  generateExecutionSummary(plan, results) {
    return `Executed ${results.length} steps for goal: ${plan.goal.description}. ${plan.expectedOutcome}`;
  }

  async generateRecoveryOptions(error) {
    return [
      'Try a simpler version of the request',
      'Check if the graph has the necessary data',
      'Verify that you have the right permissions'
    ];
  }
}

export default new CognitiveAgent();