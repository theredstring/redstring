/**
 * Tool Validation System for Redstring MCP
 * Provides robust schema validation and type checking for all tool operations
 */

import { v4 as uuidv4 } from 'uuid';
import { debugLogSync } from '../utils/debugLogger.js';

class ToolValidator {
  constructor() {
    this.schemas = new Map();
    this.validationCache = new Map();
    this.registerCoreSchemas();
  }

  /**
   * Register core tool schemas
   */
  registerCoreSchemas() {
    // Graph traversal schema
    this.registerSchema('traverse_semantic_graph', {
      type: 'object',
      required: ['start_entity'],
      properties: {
        start_entity: { 
          type: 'string', 
          minLength: 1,
          description: 'Starting node ID or name' 
        },
        relationship_types: { 
          type: 'array', 
          items: { type: 'string' },
          default: [],
          description: 'Types of relationships to follow'
        },
        semantic_threshold: { 
          type: 'number', 
          minimum: 0,
          maximum: 1,
          default: 0.7,
          description: 'Minimum semantic similarity threshold'
        },
        max_depth: { 
          type: 'integer', 
          minimum: 1,
          maximum: 10,
          default: 3,
          description: 'Maximum traversal depth'
        }
      }
    });

    // Node prototype creation schema (creates reusable types)
    this.registerSchema('create_node_prototype', {
      type: 'object',
      required: ['name'],
      properties: {
        name: { 
          type: 'string', 
          minLength: 1,
          maxLength: 200,
          description: 'Prototype name' 
        },
        description: { 
          type: 'string', 
          maxLength: 1000,
          default: '',
          description: 'Prototype description' 
        },
        color: { 
          type: 'string', 
          pattern: '^#[0-9A-Fa-f]{6}$',
          default: '#4A90E2',
          description: 'Hex color code' 
        },
        type_node_id: { 
          type: 'string', 
          default: 'base-thing-prototype',
          description: 'Parent type prototype ID (defaults to Thing)' 
        },
        ai_metadata: { 
          type: 'object',
          default: {},
          description: 'AI creation metadata'
        }
      }
    });

    // Node instance creation schema (places prototype in graph)
    this.registerSchema('create_node_instance', {
      type: 'object',
      required: ['prototype_id', 'graph_id'],
      properties: {
        prototype_id: { 
          type: 'string', 
          description: 'ID of prototype to instantiate' 
        },
        graph_id: { 
          type: 'string', 
          description: 'Target graph ID' 
        },
        x: { 
          type: 'number',
          default: 0,
          description: 'X coordinate for instance' 
        },
        y: { 
          type: 'number',
          default: 0,
          description: 'Y coordinate for instance' 
        },
        scale: { 
          type: 'number',
          minimum: 0.1,
          maximum: 5.0,
          default: 1.0,
          description: 'Instance scale' 
        },
        instance_id: { 
          type: 'string', 
          description: 'Optional specific instance ID' 
        }
      }
    });

    // Edge creation schema (works with instances in graphs)
    this.registerSchema('create_edge', {
      type: 'object',
      required: ['source_instance_id', 'target_instance_id', 'graph_id'],
      properties: {
        source_instance_id: { 
          type: 'string', 
          description: 'Source instance ID in graph' 
        },
        target_instance_id: { 
          type: 'string', 
          description: 'Target instance ID in graph' 
        },
        graph_id: { 
          type: 'string', 
          description: 'Graph containing the instances' 
        },
        edge_prototype_id: { 
          type: 'string',
          default: 'base-connection-prototype',
          description: 'Type of edge (defaults to basic Connection)' 
        },
        name: { 
          type: 'string',
          maxLength: 200,
          default: '',
          description: 'Optional edge name/label' 
        },
        description: { 
          type: 'string',
          maxLength: 1000,
          default: '',
          description: 'Optional edge description' 
        },
        directionality: {
          type: 'object',
          properties: {
            arrowsToward: {
              type: 'array',
              items: { type: 'string' },
              description: 'Instance IDs that arrows point toward'
            }
          },
          default: { arrowsToward: [] },
          description: 'Edge directionality configuration'
        },
        definitionNode: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            color: { type: 'string' },
            description: { type: 'string' }
          },
          description: 'Node prototype definition for the edge relationship'
        },
        ai_metadata: {
          type: 'object',
          default: {},
          description: 'AI creation metadata'
        }
      }
    });

    // Pattern identification schema
    this.registerSchema('identify_patterns', {
      type: 'object',
      required: ['pattern_type'],
      properties: {
        pattern_type: { 
          type: 'string', 
          enum: ['structural', 'semantic', 'temporal', 'spatial'],
          description: 'Type of pattern to identify'
        },
        min_occurrences: { 
          type: 'integer', 
          minimum: 2,
          maximum: 100,
          default: 2,
          description: 'Minimum pattern occurrences'
        },
        graph_id: { 
          type: 'string', 
          description: 'Target graph ID (defaults to active)' 
        },
        abstraction_level: { 
          type: 'string', 
          enum: ['concrete', 'abstract', 'both'],
          default: 'both',
          description: 'Level of abstraction to analyze'
        }
      }
    });

    // Graph management schemas
    this.registerSchema('get_active_graph', {
      type: 'object',
      properties: {},
      additionalProperties: false
    });

    this.registerSchema('list_available_graphs', {
      type: 'object',
      properties: {},
      additionalProperties: false
    });

    this.registerSchema('create_graph', {
      type: 'object',
      required: ['name'],
      properties: {
        name: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: 'Graph name'
        },
        description: {
          type: 'string',
          maxLength: 1000,
          default: '',
          description: 'Graph description'
        },
        color: {
          type: 'string',
          pattern: '^#[0-9A-Fa-f]{6}$',
          default: '#4A90E2',
          description: 'Graph color'
        }
      }
    });

    this.registerSchema('create_subgraph', {
      type: 'object',
      required: ['graph_id', 'graph_spec'],
      properties: {
        graph_id: {
          type: 'string',
          description: 'Target graph ID'
        },
        graph_spec: {
          type: 'object',
          required: ['nodes'],
          properties: {
            nodes: {
              type: 'array',
              items: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', minLength: 1 },
                  description: { type: 'string', default: '' },
                  color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$', default: '#5B6CFF' }
                }
              },
              description: 'Array of nodes to create'
            },
            edges: {
              type: 'array',
              items: {
                type: 'object',
                required: ['source', 'target'],
                properties: {
                  source: { type: 'string' },
                  target: { type: 'string' },
                  relation: { type: 'string', default: '' },
                  type: { type: 'string', default: '' }
                }
              },
              default: [],
              description: 'Array of edges to create'
            }
          },
          description: 'Specification of nodes and edges to create'
        },
        layout_algorithm: {
          type: 'string',
          enum: ['force', 'force-directed', 'hierarchical', 'tree', 'radial', 'orbit', 'grid', 'circular', 'circle'],
          default: 'force',
          description: 'Layout algorithm to use for positioning nodes'
        },
        layout_mode: {
          type: 'string',
          enum: ['auto', 'full', 'partial'],
          default: 'auto',
          description: 'Controls whether new nodes are laid out relative to the existing layout (partial)'
        }
      }
    });

    this.registerSchema('define_connections', {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'Target graph to define connection types (defaults to active graph)'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 32,
          description: 'Maximum number of edges to define in this run'
        },
        includeGeneralTypes: {
          type: 'boolean',
          default: false,
          description: 'Also define edges with very generic names (connects, relates, links)'
        }
      }
    });

    this.registerSchema('create_populated_graph', {
      type: 'object',
      required: ['graph_spec'],  // name is optional when graph_id is provided (expanding existing graph)
      properties: {
        name: {
          type: 'string',
          minLength: 1,
          description: 'Name of the graph to create (required for new graphs, optional when expanding existing via graph_id)'
        },
        description: {
          type: 'string',
          default: '',
          description: 'Optional description'
        },
        graph_id: {
          type: 'string',
          description: 'Optional graph ID to use when creating the graph (enables follow-up tasks in the same DAG)'
        },
        graph_spec: {
          type: 'object',
          required: ['nodes'],
          properties: {
            nodes: {
              type: 'array',
              items: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', minLength: 1 },
                  description: { type: 'string', default: '' },
                  color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$', default: '#5B6CFF' }
                }
              },
              description: 'Array of nodes to create'
            },
            edges: {
              type: 'array',
              items: {
                type: 'object',
                required: ['source', 'target'],
                properties: {
                  source: { type: 'string' },
                  target: { type: 'string' },
                  relation: { type: 'string', default: '' },
                  type: { type: 'string', default: '' }
                }
              },
              default: [],
              description: 'Array of edges to create'
            },
            groups: {
              type: 'array',
              items: {
                type: 'object',
                required: ['name', 'memberNames'],
                properties: {
                  name: { type: 'string', minLength: 1 },
                  color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$', default: '#8B0000' },
                  memberNames: { type: 'array', items: { type: 'string' }, default: [] }
                }
              },
              default: [],
              description: 'Array of groups to create (each group contains memberNames referencing node names)'
            }
          },
          description: 'Specification of nodes, edges, and groups'
        },
        layout_algorithm: {
          type: 'string',
          enum: ['force', 'force-directed', 'hierarchical', 'tree', 'radial', 'orbit', 'grid', 'circular', 'circle'],
          default: 'force',
          description: 'Layout algorithm for positioning'
        },
        layout_mode: {
          type: 'string',
          enum: ['auto', 'full', 'partial'],
          default: 'auto',
          description: 'Controls whether new nodes are laid out relative to existing layout (partial)'
        }
      }
    });

    this.registerSchema('create_subgraph_in_new_graph', {
      type: 'object',
      required: ['graph_name', 'graph_spec'],
      properties: {
        graph_name: {
          type: 'string',
          description: 'Name of the newly created graph to populate'
        },
        graph_spec: {
          type: 'object',
          required: ['nodes'],
          properties: {
            nodes: {
              type: 'array',
              items: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', minLength: 1 },
                  description: { type: 'string', default: '' },
                  color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$', default: '#5B6CFF' }
                }
              },
              description: 'Array of nodes to create'
            },
            edges: {
              type: 'array',
              items: {
                type: 'object',
                required: ['source', 'target'],
                properties: {
                  source: { type: 'string' },
                  target: { type: 'string' },
                  relation: { type: 'string', default: '' },
                  type: { type: 'string', default: '' }
                }
              },
              default: [],
              description: 'Array of edges to create'
            }
          },
          description: 'Specification of nodes and edges to create'
        },
        layout_algorithm: {
          type: 'string',
          enum: ['force', 'force-directed', 'hierarchical', 'tree', 'radial', 'orbit', 'grid', 'circular', 'circle'],
          default: 'force',
          description: 'Layout algorithm to use for positioning nodes'
        }
      }
    });

    this.registerSchema('update_node_prototype', {
      type: 'object',
      required: ['prototype_id'],
      properties: {
        prototype_id: {
          type: 'string',
          description: 'ID of the prototype to update'
        },
        name: {
          type: 'string',
          minLength: 1,
          description: 'New name for the prototype'
        },
        description: {
          type: 'string',
          description: 'New description for the prototype'
        },
        color: {
          type: 'string',
          pattern: '^#[0-9A-Fa-f]{6}$',
          description: 'New hex color for the prototype'
        }
      }
    });

    this.registerSchema('delete_node_instance', {
      type: 'object',
      required: ['graph_id', 'instance_id'],
      properties: {
        graph_id: {
          type: 'string',
          description: 'Graph containing the instance'
        },
        instance_id: {
          type: 'string',
          description: 'ID of the instance to delete'
        }
      }
    });

    this.registerSchema('delete_graph', {
      type: 'object',
      required: ['graph_id'],
      properties: {
        graph_id: {
          type: 'string',
          description: 'ID of the graph to delete'
        }
      }
    });

    this.registerSchema('open_graph', {
      type: 'object',
      required: ['graph_id'],
      properties: {
        graph_id: {
          type: 'string',
          description: 'Graph ID to open'
        }
      }
    });

    this.registerSchema('set_active_graph', {
      type: 'object',
      required: ['graph_id'],
      properties: {
        graph_id: {
          type: 'string',
          description: 'Graph ID to make active'
        }
      }
    });

    this.registerSchema('create_node', {
      type: 'object',
      required: ['name', 'graph_id'],
      properties: {
        name: { type: 'string' },
        graph_id: { type: 'string' },
        description: { type: 'string', default: '' },
        color: { type: 'string', default: '#5B6CFF' },
        x: { type: 'number', default: 0 },
        y: { type: 'number', default: 0 }
      }
    });

    // Query schemas
    this.registerSchema('search_nodes', {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          minLength: 1,
          description: 'Search query string'
        },
        graph_id: {
          type: 'string',
          description: 'Limit search to specific graph (optional)'
        },
        search_type: {
          type: 'string',
          enum: ['prototypes', 'instances', 'both'],
          default: 'both',
          description: 'What to search'
        }
      }
    });

    this.registerSchema('get_graph_instances', {
      type: 'object',
      properties: {
        graph_id: {
          type: 'string',
          description: 'Graph ID (defaults to active graph)'
        }
      }
    });

    this.registerSchema('verify_state', {
      type: 'object',
      properties: {},
      additionalProperties: false
    });

    // Read graph structure schema (semantic view without spatial data)
    this.registerSchema('read_graph_structure', {
      type: 'object',
      properties: {
        graph_id: {
          type: 'string',
          description: 'Graph ID to read (defaults to active graph)'
        },
        include_edges: {
          type: 'boolean',
          default: true,
          description: 'Whether to include edge information'
        },
        include_descriptions: {
          type: 'boolean',
          default: true,
          description: 'Whether to include node/edge descriptions'
        }
      }
    });

    // New inspection tools
    this.registerSchema('get_edge_info', {
      type: 'object',
      required: ['source_name', 'target_name'],
      properties: {
        graph_id: {
          type: 'string',
          description: 'Graph ID (defaults to active graph)'
        },
        source_name: {
          type: 'string',
          minLength: 1,
          description: 'Source node name'
        },
        target_name: {
          type: 'string',
          minLength: 1,
          description: 'Target node name'
        }
      }
    });

    this.registerSchema('get_node_definition', {
      type: 'object',
      required: ['node_id'],
      properties: {
        node_id: {
          type: 'string',
          description: 'Node instance ID'
        },
        graph_id: {
          type: 'string',
          description: 'Graph ID (defaults to active graph)'
        }
      }
    });

    // Deletion tools
    this.registerSchema('delete_edge', {
      type: 'object',
      required: ['graph_id', 'edge_id'],
      properties: {
        graph_id: {
          type: 'string',
          description: 'Graph ID containing the edge'
        },
        edge_id: {
          type: 'string',
          description: 'Edge ID to delete'
        }
      }
    });

    this.registerSchema('delete_node_prototype', {
      type: 'object',
      required: ['prototype_id'],
      properties: {
        prototype_id: {
          type: 'string',
          description: 'Prototype ID to delete'
        }
      }
    });

    // Group tools
    // #region agent log
    debugLogSync('toolValidator.js:registerSchema-create_group', 'Registering create_group schema with graph_id', { required: ['graph_id'], properties_keys: ['graph_id', 'name', 'color', 'memberInstanceIds'] }, 'debug-session', 'H1');
    // #endregion
    this.registerSchema('create_group', {
      type: 'object',
      required: ['graph_id'],
      properties: {
        graph_id: {
          type: 'string',
          description: 'Graph ID'
        },
        name: {
          type: 'string',
          default: 'Group',
          description: 'Group name'
        },
        color: {
          type: 'string',
          pattern: '^#[0-9A-Fa-f]{6}$',
          default: '#8B0000',
          description: 'Group color'
        },
        memberInstanceIds: {
          type: 'array',
          items: { type: 'string' },
          default: [],
          description: 'Instance IDs to include in group'
        }
      }
    });

    this.registerSchema('convert_to_node_group', {
      type: 'object',
      required: ['graphId', 'groupId'],
      properties: {
        graphId: {
          type: 'string',
          description: 'Graph ID'
        },
        groupId: {
          type: 'string',
          description: 'Group ID to convert'
        },
        nodePrototypeId: {
          type: 'string',
          description: 'Existing prototype ID to link (if not creating new)'
        },
        createNewPrototype: {
          type: 'boolean',
          default: false,
          description: 'Create a new prototype for the node-group'
        },
        newPrototypeName: {
          type: 'string',
          description: 'Name for new prototype (if createNewPrototype is true)'
        },
        newPrototypeColor: {
          type: 'string',
          pattern: '^#[0-9A-Fa-f]{6}$',
          default: '#8B0000',
          description: 'Color for new prototype'
        }
      }
    });

    this.registerSchema('update_group', {
      type: 'object',
      required: ['graph_id', 'group_id'],
      properties: {
        graph_id: {
          type: 'string',
          description: 'Graph ID containing the group'
        },
        group_id: {
          type: 'string',
          description: 'Group ID to update'
        },
        new_name: {
          type: 'string',
          description: 'New name for the group'
        },
        new_color: {
          type: 'string',
          pattern: '^#[0-9A-Fa-f]{6}$',
          description: 'New color for the group'
        },
        add_member_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Instance IDs to add to group'
        },
        remove_member_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Instance IDs to remove from group'
        }
      }
    });

    this.registerSchema('delete_group', {
      type: 'object',
      required: ['graph_id', 'group_id'],
      properties: {
        graph_id: {
          type: 'string',
          description: 'Graph ID containing the group'
        },
        group_id: {
          type: 'string',
          description: 'Group ID to delete'
        }
      }
    });

    this.registerSchema('combine_node_group', {
      type: 'object',
      required: ['graph_id', 'group_id'],
      properties: {
        graph_id: {
          type: 'string',
          description: 'Graph ID containing the group'
        },
        group_id: {
          type: 'string',
          description: 'Thing-Group ID to combine/collapse'
        }
      }
    });

    // Semantic tools
    this.registerSchema('sparql_query', {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          minLength: 1,
          description: 'SPARQL query string'
        },
        endpoint: {
          type: 'string',
          default: 'https://query.wikidata.org/sparql',
          description: 'SPARQL endpoint URL'
        }
      }
    });

    this.registerSchema('semantic_search', {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          minLength: 1,
          description: 'Search query string'
        }
      }
    });
  }

  /**
   * Register a new tool schema
   */
  registerSchema(toolName, schema) {
    this.schemas.set(toolName, {
      ...schema,
      additionalProperties: false // Strict validation by default
    });
  }

  /**
   * Validate tool arguments against schema
   */
  validateToolArgs(toolName, args) {
    const schema = this.schemas.get(toolName);
    // #region agent log
    if (toolName === 'create_group') {
      debugLogSync('toolValidator.js:validateToolArgs', 'Validating create_group', { toolName, argsKeys: Object.keys(args || {}), schemaRequired: schema?.required, schemaPropsKeys: schema?.properties ? Object.keys(schema.properties) : null }, 'debug-session', 'H1-H3');
    }
    // #endregion
    if (!schema) {
      return {
        valid: false,
        error: `Unknown tool: ${toolName}`,
        code: 'UNKNOWN_TOOL'
      };
    }

    try {
      const result = this.validateAgainstSchema(args, schema);
      
      if (result.valid) {
        // Apply defaults and sanitize
        const sanitized = this.applySchemaDefaults(args, schema);
        return {
          valid: true,
          sanitized,
          applied_defaults: this.getAppliedDefaults(args, sanitized, schema)
        };
      } else {
        return result;
      }
    } catch (error) {
      return {
        valid: false,
        error: `Validation error: ${error.message}`,
        code: 'VALIDATION_ERROR'
      };
    }
  }

  /**
   * Core validation logic
   */
  validateAgainstSchema(data, schema) {
    const errors = [];

    // Check required properties
    if (schema.required) {
      for (const required of schema.required) {
        if (!(required in data)) {
          errors.push(`Missing required property: ${required}`);
        }
      }
    }

    // Validate each property
    if (schema.properties) {
      for (const [key, value] of Object.entries(data)) {
        const propSchema = schema.properties[key];
        if (!propSchema) {
          if (!schema.additionalProperties) {
            errors.push(`Unknown property: ${key}`);
          }
          continue;
        }

        const propValidation = this.validateProperty(value, propSchema, key);
        if (!propValidation.valid) {
          errors.push(...propValidation.errors);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      error: errors.length > 0 ? errors.join('; ') : null,
      code: errors.length > 0 ? 'VALIDATION_FAILED' : null
    };
  }

  /**
   * Validate individual property
   */
  validateProperty(value, schema, propertyName) {
    const errors = [];

    // Type validation
    if (schema.type) {
      if (!this.validateType(value, schema.type)) {
        errors.push(`Property '${propertyName}' must be of type ${schema.type}`);
        return { valid: false, errors };
      }
    }

    // String validations
    if (schema.type === 'string') {
      if (schema.minLength && value.length < schema.minLength) {
        errors.push(`Property '${propertyName}' must be at least ${schema.minLength} characters`);
      }
      if (schema.maxLength && value.length > schema.maxLength) {
        errors.push(`Property '${propertyName}' must be at most ${schema.maxLength} characters`);
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
        errors.push(`Property '${propertyName}' does not match required pattern`);
      }
      if (schema.format === 'uuid' && !this.isValidUUID(value)) {
        errors.push(`Property '${propertyName}' must be a valid UUID`);
      }
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`Property '${propertyName}' must be one of: ${schema.enum.join(', ')}`);
      }
    }

    // Number validations
    if (schema.type === 'number' || schema.type === 'integer') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`Property '${propertyName}' must be at least ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`Property '${propertyName}' must be at most ${schema.maximum}`);
      }
      if (schema.type === 'integer' && !Number.isInteger(value)) {
        errors.push(`Property '${propertyName}' must be an integer`);
      }
    }

    // Array validations
    if (schema.type === 'array') {
      if (schema.items && Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const itemValidation = this.validateProperty(value[i], schema.items, `${propertyName}[${i}]`);
          if (!itemValidation.valid) {
            errors.push(...itemValidation.errors);
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Type checking
   */
  validateType(value, expectedType) {
    switch (expectedType) {
      case 'string': return typeof value === 'string';
      case 'number': return typeof value === 'number' && !isNaN(value);
      case 'integer': return typeof value === 'number' && Number.isInteger(value);
      case 'boolean': return typeof value === 'boolean';
      case 'array': return Array.isArray(value);
      case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
      default: return true;
    }
  }

  /**
   * UUID validation
   */
  isValidUUID(str) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }

  /**
   * Apply schema defaults
   */
  applySchemaDefaults(data, schema) {
    const result = { ...data };

    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (!(key in result) && 'default' in propSchema) {
          result[key] = propSchema.default;
        }
      }
    }

    return result;
  }

  /**
   * Track which defaults were applied
   */
  getAppliedDefaults(original, sanitized, schema) {
    const applied = {};
    
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (!(key in original) && key in sanitized && 'default' in propSchema) {
          applied[key] = propSchema.default;
        }
      }
    }

    return applied;
  }

  /**
   * Get available tools
   */
  getAvailableTools() {
    return Array.from(this.schemas.keys());
  }

  /**
   * Get tool schema
   */
  getToolSchema(toolName) {
    return this.schemas.get(toolName);
  }
}

// Export singleton instance
const toolValidator = new ToolValidator();
export default toolValidator;