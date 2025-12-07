/**
 * Druid Mind Panel - Visualize The Druid's cognitive state
 * Shows goals, beliefs, observations, plans, episodic and semantic memory
 */

import React from 'react';
import { Brain, Target, Lightbulb, Eye, ListChecks, History, BookOpen } from 'lucide-react';

const DruidMindPanel = ({ druidInstance }) => {
  if (!druidInstance) {
    return (
      <div className="p-4 text-gray-500 text-sm">
        The Druid is not initialized.
      </div>
    );
  }

  const cognitiveGraphs = druidInstance.getCognitiveGraphs();

  const GraphSection = ({ title, icon: Icon, graph, color }) => {
    if (!graph) return null;
    
    const instances = Array.from(graph.instances?.values() || []);
    
    return (
      <div className="mb-4 border rounded-lg p-3 bg-white">
        <div className="flex items-center gap-2 mb-2">
          <Icon className={`w-4 h-4 ${color}`} />
          <h3 className="font-semibold text-sm">{title}</h3>
          <span className="text-xs text-gray-500 ml-auto">
            {instances.length} items
          </span>
        </div>
        {instances.length === 0 ? (
          <p className="text-xs text-gray-400 italic">Empty</p>
        ) : (
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {instances.slice(0, 5).map((instance, idx) => (
              <div key={instance.id || idx} className="text-xs p-1 bg-gray-50 rounded">
                <div className="font-medium">{instance.name || 'Untitled'}</div>
                {instance.metadata?.confidence !== undefined && (
                  <div className="text-gray-500">
                    Confidence: {(instance.metadata.confidence * 100).toFixed(0)}%
                  </div>
                )}
                {instance.metadata?.priority !== undefined && (
                  <div className="text-gray-500">
                    Priority: {(instance.metadata.priority * 100).toFixed(0)}%
                  </div>
                )}
              </div>
            ))}
            {instances.length > 5 && (
              <div className="text-xs text-gray-400 italic">
                +{instances.length - 5} more...
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-4 space-y-2 max-h-[600px] overflow-y-auto">
      <div className="flex items-center gap-2 mb-3">
        <Brain className="w-5 h-5 text-purple-600" />
        <h2 className="font-bold text-lg">The Druid's Mind</h2>
      </div>
      
      <p className="text-xs text-gray-600 mb-4">
        The Druid is an agent whose cognitive state is represented as a Redstring graph.
        This panel shows its internal thoughts, goals, beliefs, and memories.
      </p>

      <GraphSection
        title="Goals"
        icon={Target}
        graph={cognitiveGraphs.goals}
        color="text-red-600"
      />
      
      <GraphSection
        title="Beliefs"
        icon={Lightbulb}
        graph={cognitiveGraphs.beliefs}
        color="text-cyan-600"
      />
      
      <GraphSection
        title="Observations"
        icon={Eye}
        graph={cognitiveGraphs.observations}
        color="text-green-600"
      />
      
      <GraphSection
        title="Plans"
        icon={ListChecks}
        graph={cognitiveGraphs.plans}
        color="text-pink-600"
      />
      
      <GraphSection
        title="Episodic Memory"
        icon={History}
        graph={cognitiveGraphs.episodic}
        color="text-purple-600"
      />
      
      <GraphSection
        title="Semantic Memory"
        icon={BookOpen}
        graph={cognitiveGraphs.semantic}
        color="text-blue-600"
      />
    </div>
  );
};

export default DruidMindPanel;



