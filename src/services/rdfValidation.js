/**
 * RDF Validation Service
 * 
 * Checks RDF consistency across local and external data,
 * validates ontology compliance, and reports semantic inconsistencies.
 */

import { rdfResolver } from './rdfResolver.js';
import { sparqlClient } from './sparqlClient.js';

// Validation rule types
const RULE_TYPES = {
  CONSISTENCY: 'consistency',
  ONTOLOGY: 'ontology',
  SYNTAX: 'syntax',
  SEMANTIC: 'semantic'
};

// Validation severity levels
const SEVERITY = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info'
};

export class RDFValidation {
  constructor() {
    this.validationRules = new Map();
    this.validationResults = new Map();
    this.ontologyCache = new Map();
    
    this._initializeValidationRules();
  }

  /**
   * Initialize built-in validation rules
   * @private
   */
  _initializeValidationRules() {
    // Consistency rules
    this.addValidationRule('no_circular_inheritance', {
      type: RULE_TYPES.CONSISTENCY,
      severity: SEVERITY.ERROR,
      description: 'Detect circular inheritance relationships',
      validate: this._validateNoCircularInheritance.bind(this)
    });

    this.addValidationRule('unique_uri', {
      type: RULE_TYPES.CONSISTENCY,
      severity: SEVERITY.ERROR,
      description: 'Ensure URIs are unique across the graph',
      validate: this._validateUniqueURIs.bind(this)
    });

    // Ontology rules
    this.addValidationRule('class_definition', {
      type: RULE_TYPES.ONTOLOGY,
      severity: SEVERITY.WARNING,
      description: 'Check if classes have proper definitions',
      validate: this._validateClassDefinitions.bind(this)
    });

    this.addValidationRule('property_domain_range', {
      type: RULE_TYPES.ONTOLOGY,
      severity: SEVERITY.WARNING,
      description: 'Validate property domain and range constraints',
      validate: this._validatePropertyDomainRange.bind(this)
    });

    // Semantic rules
    this.addValidationRule('external_link_resolution', {
      type: RULE_TYPES.SEMANTIC,
      severity: SEVERITY.WARNING,
      description: 'Check if external links can be resolved',
      validate: this._validateExternalLinkResolution.bind(this)
    });

    this.addValidationRule('equivalent_class_consistency', {
      type: RULE_TYPES.SEMANTIC,
      severity: SEVERITY.INFO,
      description: 'Validate consistency of equivalent class relationships',
      validate: this._validateEquivalentClassConsistency.bind(this)
    });
  }

  /**
   * Add a custom validation rule
   * @param {string} ruleId - Rule identifier
   * @param {Object} rule - Rule configuration
   */
  addValidationRule(ruleId, rule) {
    this.validationRules.set(ruleId, {
      id: ruleId,
      enabled: true,
      ...rule
    });
  }

  /**
   * Remove a validation rule
   * @param {string} ruleId - Rule identifier
   */
  removeValidationRule(ruleId) {
    this.validationRules.delete(ruleId);
  }

  /**
   * Enable/disable a validation rule
   * @param {string} ruleId - Rule identifier
   * @param {boolean} enabled - Whether to enable the rule
   */
  setRuleEnabled(ruleId, enabled) {
    const rule = this.validationRules.get(ruleId);
    if (rule) {
      rule.enabled = enabled;
    }
  }

  /**
   * Validate a complete graph
   * @param {Object} graphData - Graph data including nodes, edges, and metadata
   * @param {Object} options - Validation options
   * @returns {Promise<Object>} Validation results
   */
  async validateGraph(graphData, options = {}) {
    const startTime = Date.now();
    const results = {
      graphId: graphData.id,
      timestamp: new Date().toISOString(),
      rules: [],
      summary: {
        total: 0,
        errors: 0,
        warnings: 0,
        info: 0
      },
      duration: 0
    };

    try {
      // Run all enabled validation rules
      for (const [ruleId, rule] of this.validationRules.entries()) {
        if (!rule.enabled) continue;

        try {
          const ruleResult = await rule.validate(graphData, options);
          results.rules.push({
            ruleId,
            ruleName: rule.description,
            severity: rule.severity,
            ...ruleResult
          });

          // Update summary
          results.summary.total++;
          if (ruleResult.issues) {
            results.summary[ruleResult.issues.length > 0 ? ruleResult.issues[0].severity : 'info']++;
          }
        } catch (error) {
          console.error(`[RDF Validation] Rule ${ruleId} failed:`, error);
          results.rules.push({
            ruleId,
            ruleName: rule.description,
            severity: rule.severity,
            error: error.message,
            issues: []
          });
        }
      }

      results.duration = Date.now() - startTime;
      
      // Cache results
      this.validationResults.set(graphData.id, results);
      
      return results;
    } catch (error) {
      console.error('[RDF Validation] Graph validation failed:', error);
      throw error;
    }
  }

  /**
   * Validate a specific node
   * @param {Object} nodeData - Node data
   * @param {Object} graphData - Graph context
   * @param {Object} options - Validation options
   * @returns {Promise<Object>} Validation results
   */
  async validateNode(nodeData, graphData, options = {}) {
    const results = {
      nodeId: nodeData.id,
      timestamp: new Date().toISOString(),
      issues: [],
      warnings: [],
      suggestions: []
    };

    try {
      // Validate node-specific rules
      if (nodeData.externalLinks && nodeData.externalLinks.length > 0) {
        const linkValidation = await this._validateExternalLinkResolution(
          { nodes: [nodeData] }, 
          options
        );
        results.issues.push(...linkValidation.issues);
      }

      // Validate class relationships
      if (nodeData.typeNodeId) {
        const classValidation = await this._validateClassDefinitions(
          { nodes: [nodeData] }, 
          options
        );
        results.issues.push(...classValidation.issues);
      }

      return results;
    } catch (error) {
      console.error(`[RDF Validation] Node validation failed for ${nodeData.id}:`, error);
      throw error;
    }
  }

  /**
   * Get validation results for a graph
   * @param {string} graphId - Graph identifier
   * @returns {Object} Validation results
   */
  getValidationResults(graphId) {
    return this.validationResults.get(graphId);
  }

  /**
   * Clear validation results
   * @param {string} graphId - Optional graph identifier to clear specific results
   */
  clearValidationResults(graphId = null) {
    if (graphId) {
      this.validationResults.delete(graphId);
    } else {
      this.validationResults.clear();
    }
  }

  /**
   * Get validation statistics
   * @returns {Object} Validation statistics
   */
  getValidationStats() {
    const stats = {
      totalGraphs: this.validationResults.size,
      totalRules: this.validationRules.size,
      enabledRules: 0,
      disabledRules: 0
    };

    for (const rule of this.validationRules.values()) {
      if (rule.enabled) {
        stats.enabledRules++;
      } else {
        stats.disabledRules++;
      }
    }

    return stats;
  }

  /**
   * Validate no circular inheritance
   * @private
   */
  async _validateNoCircularInheritance(graphData, options) {
    const issues = [];
    const inheritanceGraph = new Map();

    // Build inheritance graph
    for (const node of graphData.nodes || []) {
      if (node.typeNodeId) {
        if (!inheritanceGraph.has(node.id)) {
          inheritanceGraph.set(node.id, new Set());
        }
        inheritanceGraph.get(node.id).add(node.typeNodeId);
      }
    }

    // Check for cycles using DFS
    const visited = new Set();
    const recursionStack = new Set();

    const hasCycle = (nodeId) => {
      if (recursionStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      recursionStack.add(nodeId);

      const children = inheritanceGraph.get(nodeId) || new Set();
      for (const childId of children) {
        if (hasCycle(childId)) return true;
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of inheritanceGraph.keys()) {
      if (hasCycle(nodeId)) {
        issues.push({
          severity: SEVERITY.ERROR,
          message: `Circular inheritance detected involving node: ${nodeId}`,
          nodeId,
          rule: 'no_circular_inheritance'
        });
      }
    }

    return { issues };
  }

  /**
   * Validate unique URIs
   * @private
   */
  async _validateUniqueURIs(graphData, options) {
    const issues = [];
    const uriMap = new Map();

    for (const node of graphData.nodes || []) {
      if (node.uri) {
        if (uriMap.has(node.uri)) {
          issues.push({
            severity: SEVERITY.ERROR,
            message: `Duplicate URI found: ${node.uri}`,
            nodeId: node.id,
            duplicateNodeId: uriMap.get(node.uri),
            rule: 'unique_uri'
          });
        } else {
          uriMap.set(node.uri, node.id);
        }
      }
    }

    return { issues };
  }

  /**
   * Validate class definitions
   * @private
   */
  async _validateClassDefinitions(graphData, options) {
    const issues = [];
    const suggestions = [];

    for (const node of graphData.nodes || []) {
      if (node.typeNodeId) {
        const typeNode = graphData.nodes.find(n => n.id === node.typeNodeId);
        if (typeNode && !typeNode.description && !typeNode.externalLinks) {
          issues.push({
            severity: SEVERITY.WARNING,
            message: `Class ${typeNode.name || typeNode.id} lacks definition`,
            nodeId: typeNode.id,
            rule: 'class_definition'
          });

          suggestions.push({
            type: 'add_description',
            message: 'Consider adding a description or external link to define this class',
            nodeId: typeNode.id
          });
        }
      }
    }

    return { issues, suggestions };
  }

  /**
   * Validate property domain and range constraints
   * @private
   */
  async _validatePropertyDomainRange(graphData, options) {
    const issues = [];
    const edges = graphData.edges || [];

    for (const edge of edges) {
      if (edge.predicate && edge.source && edge.target) {
        const sourceNode = graphData.nodes.find(n => n.id === edge.source);
        const targetNode = graphData.nodes.find(n => n.id === edge.target);
        const predicateNode = graphData.nodes.find(n => n.id === edge.predicate);

        if (predicateNode && predicateNode.domain && predicateNode.range) {
          // Check domain constraint
          if (predicateNode.domain !== sourceNode.typeNodeId) {
            issues.push({
              severity: SEVERITY.WARNING,
              message: `Property ${predicateNode.name} domain constraint violated`,
              edgeId: edge.id,
              expectedDomain: predicateNode.domain,
              actualSourceType: sourceNode.typeNodeId,
              rule: 'property_domain_range'
            });
          }

          // Check range constraint
          if (predicateNode.range !== targetNode.typeNodeId) {
            issues.push({
              severity: SEVERITY.WARNING,
              message: `Property ${predicateNode.name} range constraint violated`,
              edgeId: edge.id,
              expectedRange: predicateNode.range,
              actualTargetType: targetNode.typeNodeId,
              rule: 'property_domain_range'
            });
          }
        }
      }
    }

    return { issues };
  }

  /**
   * Validate external link resolution
   * @private
   */
  async _validateExternalLinkResolution(graphData, options) {
    const issues = [];
    const unresolvedLinks = [];

    for (const node of graphData.nodes || []) {
      if (node.externalLinks) {
        for (const link of node.externalLinks) {
          try {
            await rdfResolver.resolveURI(link, { timeout: 5000 });
          } catch (error) {
            unresolvedLinks.push({
              nodeId: node.id,
              uri: link,
              error: error.message
            });
          }
        }
      }
    }

    if (unresolvedLinks.length > 0) {
      issues.push({
        severity: SEVERITY.WARNING,
        message: `${unresolvedLinks.length} external links could not be resolved`,
        unresolvedLinks,
        rule: 'external_link_resolution'
      });
    }

    return { issues };
  }

  /**
   * Validate equivalent class consistency
   * @private
   */
  async _validateEquivalentClassConsistency(graphData, options) {
    const issues = [];
    const equivalentClasses = new Map();

    // Collect equivalent class relationships
    for (const node of graphData.nodes || []) {
      if (node.equivalentClasses) {
        for (const equivClass of node.equivalentClasses) {
          if (!equivalentClasses.has(node.id)) {
            equivalentClasses.set(node.id, new Set());
          }
          equivalentClasses.get(node.id).add(equivClass);
        }
      }
    }

    // Check for consistency (if A ≡ B, then B ≡ A should also exist)
    for (const [nodeId, equivSet] of equivalentClasses.entries()) {
      for (const equivClass of equivSet) {
        const reverseSet = equivalentClasses.get(equivClass);
        if (!reverseSet || !reverseSet.has(nodeId)) {
          issues.push({
            severity: SEVERITY.INFO,
            message: `Asymmetric equivalent class relationship: ${nodeId} ≡ ${equivClass}`,
            nodeId,
            equivalentClass: equivClass,
            rule: 'equivalent_class_consistency'
          });
        }
      }
    }

    return { issues };
  }

  /**
   * Generate validation report
   * @param {Object} validationResults - Validation results
   * @returns {string} Formatted report
   */
  generateReport(validationResults) {
    let report = `# RDF Validation Report\n\n`;
    report += `**Graph:** ${validationResults.graphId}\n`;
    report += `**Timestamp:** ${validationResults.timestamp}\n`;
    report += `**Duration:** ${validationResults.duration}ms\n\n`;

    report += `## Summary\n`;
    report += `- Total Rules: ${validationResults.summary.total}\n`;
    report += `- Errors: ${validationResults.summary.errors}\n`;
    report += `- Warnings: ${validationResults.summary.warnings}\n`;
    report += `- Info: ${validationResults.summary.info}\n\n`;

    report += `## Rule Results\n\n`;
    
    for (const rule of validationResults.rules) {
      report += `### ${rule.ruleName}\n`;
      report += `**Severity:** ${rule.severity}\n`;
      
      if (rule.error) {
        report += `**Error:** ${rule.error}\n`;
      } else if (rule.issues && rule.issues.length > 0) {
        report += `**Issues:** ${rule.issues.length}\n`;
        for (const issue of rule.issues) {
          report += `- ${issue.message}\n`;
        }
      } else {
        report += `**Status:** ✅ Passed\n`;
      }
      
      if (rule.suggestions && rule.suggestions.length > 0) {
        report += `**Suggestions:**\n`;
        for (const suggestion of rule.suggestions) {
          report += `- ${suggestion.message}\n`;
        }
      }
      
      report += `\n`;
    }

    return report;
  }
}

// Export singleton instance
export const rdfValidation = new RDFValidation();

// Export utility functions
export const validateGraph = (graphData, options) => 
  rdfValidation.validateGraph(graphData, options);
export const validateNode = (nodeData, graphData, options) => 
  rdfValidation.validateNode(nodeData, graphData, options);
export const getValidationResults = (graphId) => 
  rdfValidation.getValidationResults(graphId);
export const generateReport = (validationResults) => 
  rdfValidation.generateReport(validationResults);
