/**
 * Druid Store - Isolated Zustand store for The Druid's cognitive state
 * This is a separate Redstring instance representing an agent's internal mind
 */

import { create } from 'zustand';
import { produce } from 'immer';
import { v4 as uuidv4 } from 'uuid';

const createDruidStore = () => {
  return create((set, get) => ({
    // Cognitive graphs - The Druid's mind
    graphs: new Map(),
    nodePrototypes: new Map(),
    edges: new Map(),
    
    // Initialize base cognitive graph types
    initialize: () => {
      set(produce((draft) => {
        // Goals graph - what the agent wants to achieve
        const goalsGraphId = 'druid-goals';
        draft.graphs.set(goalsGraphId, {
          id: goalsGraphId,
          name: 'Goals',
          description: 'Current objectives and desired outcomes',
          instances: new Map(),
          edgeIds: [],
          definingNodeIds: []
        });

        // Beliefs graph - what the agent believes about the world
        const beliefsGraphId = 'druid-beliefs';
        draft.graphs.set(beliefsGraphId, {
          id: beliefsGraphId,
          name: 'Beliefs',
          description: 'World model with confidence levels',
          instances: new Map(),
          edgeIds: [],
          definingNodeIds: []
        });

        // Observations graph - incoming data queue
        const observationsGraphId = 'druid-observations';
        draft.graphs.set(observationsGraphId, {
          id: observationsGraphId,
          name: 'Observations',
          description: 'Incoming sensory data and events',
          instances: new Map(),
          edgeIds: [],
          definingNodeIds: []
        });

        // Plans graph - action sequences
        const plansGraphId = 'druid-plans';
        draft.graphs.set(plansGraphId, {
          id: plansGraphId,
          name: 'Plans',
          description: 'Action sequences and strategies',
          instances: new Map(),
          edgeIds: [],
          definingNodeIds: []
        });

        // Episodic memory - past interactions
        const episodicGraphId = 'druid-episodic';
        draft.graphs.set(episodicGraphId, {
          id: episodicGraphId,
          name: 'Episodic Memory',
          description: 'Past interaction graphs',
          instances: new Map(),
          edgeIds: [],
          definingNodeIds: []
        });

        // Semantic memory - persistent knowledge
        const semanticGraphId = 'druid-semantic';
        draft.graphs.set(semanticGraphId, {
          id: semanticGraphId,
          name: 'Semantic Memory',
          description: 'Persistent knowledge and facts',
          instances: new Map(),
          edgeIds: [],
          definingNodeIds: []
        });
      }));
    },

    // Add a goal
    addGoal: (goalText, priority = 0.5) => {
      set(produce((draft) => {
        const goalsGraph = draft.graphs.get('druid-goals');
        if (!goalsGraph) return;

        const goalId = uuidv4();
        const instanceId = `goal-${goalId}`;
        
        // Create goal prototype if needed
        const goalProtoId = 'goal-prototype';
        if (!draft.nodePrototypes.has(goalProtoId)) {
          draft.nodePrototypes.set(goalProtoId, {
            id: goalProtoId,
            name: 'Goal',
            description: 'An objective to achieve',
            color: '#FF6B6B'
          });
        }

        goalsGraph.instances.set(instanceId, {
          id: instanceId,
          prototypeId: goalProtoId,
          name: goalText,
          x: Math.random() * 1000,
          y: Math.random() * 1000,
          metadata: { priority, createdAt: Date.now() }
        });
      }));
    },

    // Add a belief
    addBelief: (beliefText, confidence = 0.5) => {
      set(produce((draft) => {
        const beliefsGraph = draft.graphs.get('druid-beliefs');
        if (!beliefsGraph) return;

        const beliefId = uuidv4();
        const instanceId = `belief-${beliefId}`;
        
        const beliefProtoId = 'belief-prototype';
        if (!draft.nodePrototypes.has(beliefProtoId)) {
          draft.nodePrototypes.set(beliefProtoId, {
            id: beliefProtoId,
            name: 'Belief',
            description: 'A belief about the world',
            color: '#4ECDC4'
          });
        }

        beliefsGraph.instances.set(instanceId, {
          id: instanceId,
          prototypeId: beliefProtoId,
          name: beliefText,
          x: Math.random() * 1000,
          y: Math.random() * 1000,
          metadata: { confidence, createdAt: Date.now() }
        });
      }));
    },

    // Record an observation
    recordObservation: (data, source = 'unknown') => {
      set(produce((draft) => {
        const observationsGraph = draft.graphs.get('druid-observations');
        if (!observationsGraph) return;

        const obsId = uuidv4();
        const instanceId = `obs-${obsId}`;
        
        const obsProtoId = 'observation-prototype';
        if (!draft.nodePrototypes.has(obsProtoId)) {
          draft.nodePrototypes.set(obsProtoId, {
            id: obsProtoId,
            name: 'Observation',
            description: 'Incoming sensory data',
            color: '#95E1D3'
          });
        }

        observationsGraph.instances.set(instanceId, {
          id: instanceId,
          prototypeId: obsProtoId,
          name: typeof data === 'string' ? data : JSON.stringify(data),
          x: Math.random() * 1000,
          y: Math.random() * 1000,
          metadata: { source, createdAt: Date.now(), rawData: data }
        });
      }));
    },

    // Create a plan
    createPlan: (goalId, steps = []) => {
      set(produce((draft) => {
        const plansGraph = draft.graphs.get('druid-plans');
        if (!plansGraph) return;

        const planId = uuidv4();
        const instanceId = `plan-${planId}`;
        
        const planProtoId = 'plan-prototype';
        if (!draft.nodePrototypes.has(planProtoId)) {
          draft.nodePrototypes.set(planProtoId, {
            id: planProtoId,
            name: 'Plan',
            description: 'A sequence of actions',
            color: '#F38181'
          });
        }

        plansGraph.instances.set(instanceId, {
          id: instanceId,
          prototypeId: planProtoId,
          name: `Plan for ${goalId}`,
          x: Math.random() * 1000,
          y: Math.random() * 1000,
          metadata: { goalId, steps, createdAt: Date.now() }
        });
      }));
    },

    // Store an episode (past interaction)
    storeEpisode: (interaction) => {
      set(produce((draft) => {
        const episodicGraph = draft.graphs.get('druid-episodic');
        if (!episodicGraph) return;

        const episodeId = uuidv4();
        const instanceId = `episode-${episodeId}`;
        
        const episodeProtoId = 'episode-prototype';
        if (!draft.nodePrototypes.has(episodeProtoId)) {
          draft.nodePrototypes.set(episodeProtoId, {
            id: episodeProtoId,
            name: 'Episode',
            description: 'A past interaction',
            color: '#AA96DA'
          });
        }

        episodicGraph.instances.set(instanceId, {
          id: instanceId,
          prototypeId: episodeProtoId,
          name: interaction.summary || 'Interaction',
          x: Math.random() * 1000,
          y: Math.random() * 1000,
          metadata: { ...interaction, createdAt: Date.now() }
        });
      }));
    },

    // Query semantic memory
    querySemanticMemory: (query) => {
      const state = get();
      const semanticGraph = state.graphs.get('druid-semantic');
      if (!semanticGraph) return [];

      // Simple text search for now
      const results = [];
      semanticGraph.instances.forEach((instance, instanceId) => {
        const name = instance.name || '';
        if (name.toLowerCase().includes(query.toLowerCase())) {
          results.push(instance);
        }
      });
      return results;
    },

    // Get all cognitive graphs
    getCognitiveGraphs: () => {
      const state = get();
      return {
        goals: state.graphs.get('druid-goals'),
        beliefs: state.graphs.get('druid-beliefs'),
        observations: state.graphs.get('druid-observations'),
        plans: state.graphs.get('druid-plans'),
        episodic: state.graphs.get('druid-episodic'),
        semantic: state.graphs.get('druid-semantic')
      };
    }
  }));
};

export default createDruidStore;



