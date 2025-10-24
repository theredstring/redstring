/**
 * Tool Validation System for Redstring MCP
 * Provides robust schema validation and type checking for all tool operations
 */

import { v4 as uuidv4 } from 'uuid';

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