#!/usr/bin/env node

/**
 * Auto-generate API documentation from source code
 * Scans the codebase and extracts component props, function signatures,
 * class methods, and JSDoc comments to create comprehensive API docs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const docsDir = path.join(projectRoot, 'docs');

// Directories to scan for documentation
const scanDirectories = [
  'src/core',
  'src/store',
  'src/services',
  'src/components',
  'src'
];

// File extensions to process
const codeExtensions = ['.js', '.jsx', '.ts', '.tsx'];

class DocumentationGenerator {
  constructor() {
    this.extractedData = {
      components: [],
      classes: [],
      functions: [],
      stores: [],
      services: []
    };
  }

  /**
   * Main entry point - generate all documentation
   */
  async generate() {
    console.log('🔍 Scanning codebase for documentation...');

    for (const dir of scanDirectories) {
      const fullPath = path.join(projectRoot, dir);
      if (fs.existsSync(fullPath)) {
        await this.scanDirectory(fullPath, dir);
      }
    }

    console.log('📝 Generating documentation files...');
    await this.generateApiDocs();
    await this.generateComponentDocs();
    await this.generateServiceDocs();

    console.log('✅ Documentation generation complete!');
  }

  /**
   * Recursively scan directory for code files
   */
  async scanDirectory(dirPath, relativePath) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativeFilePath = path.join(relativePath, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await this.scanDirectory(fullPath, relativeFilePath);
      } else if (entry.isFile() && this.isCodeFile(entry.name)) {
        await this.analyzeFile(fullPath, relativeFilePath);
      }
    }
  }

  /**
   * Check if file should be analyzed
   */
  isCodeFile(filename) {
    return codeExtensions.some(ext => filename.endsWith(ext));
  }

  /**
   * Analyze a single code file
   */
  async analyzeFile(filePath, relativePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const analysis = this.analyzeCode(content, relativePath);

      // Categorize extracted data
      if (analysis.component) {
        this.extractedData.components.push(analysis.component);
      }
      if (analysis.classes.length > 0) {
        this.extractedData.classes.push(...analysis.classes);
      }
      if (analysis.functions.length > 0) {
        this.extractedData.functions.push(...analysis.functions);
      }
      if (analysis.store) {
        this.extractedData.stores.push(analysis.store);
      }
      if (analysis.service) {
        this.extractedData.services.push(analysis.service);
      }
    } catch (error) {
      console.warn(`⚠️  Could not analyze ${relativePath}:`, error.message);
    }
  }

  /**
   * Analyze code content and extract documentation info
   */
  analyzeCode(content, filePath) {
    const result = {
      component: null,
      classes: [],
      functions: [],
      store: null,
      service: null
    };

    // Extract JSDoc comments
    const jsdocPattern = /\/\*\*\s*\n([\s\S]*?)\*\//g;
    const jsdocs = [];
    let match;
    while ((match = jsdocPattern.exec(content)) !== null) {
      jsdocs.push(this.parseJSDoc(match[1]));
    }

    // Detect React components
    const componentMatch = content.match(/(?:export\s+(?:default\s+)?)?(?:const|function)\s+(\w+)\s*=?\s*(?:\([^)]*\)\s*=>|\([^)]*\)\s*{|function)/);
    if (componentMatch && this.isReactComponent(content)) {
      result.component = {
        name: componentMatch[1],
        filePath: filePath,
        props: this.extractProps(content),
        description: this.extractDescription(content, jsdocs),
        hooks: this.extractHooks(content),
        imports: this.extractImports(content)
      };
    }

    // Detect classes
    const classPattern = /class\s+(\w+)(?:\s+extends\s+(\w+))?\s*{([\s\S]*?)^}/gm;
    let classMatch;
    while ((classMatch = classPattern.exec(content)) !== null) {
      result.classes.push({
        name: classMatch[1],
        extends: classMatch[2] || null,
        filePath: filePath,
        methods: this.extractMethods(classMatch[3]),
        properties: this.extractProperties(classMatch[3]),
        description: this.findJSDocForSymbol(classMatch[1], jsdocs)
      });
    }

    // Detect Zustand stores
    if (content.includes('create(') && content.includes('set') && content.includes('get')) {
      result.store = {
        name: path.basename(filePath, path.extname(filePath)),
        filePath: filePath,
        state: this.extractStoreState(content),
        actions: this.extractStoreActions(content),
        selectors: this.extractStoreSelectors(content),
        description: this.findJSDocForSymbol('store', jsdocs)
      };
    }

    // Detect service modules
    if (filePath.includes('services/') || filePath.includes('Service')) {
      result.service = {
        name: path.basename(filePath, path.extname(filePath)),
        filePath: filePath,
        exports: this.extractExports(content),
        functions: this.extractTopLevelFunctions(content),
        description: this.extractDescription(content, jsdocs)
      };
    }

    return result;
  }

  /**
   * Check if file contains a React component
   */
  isReactComponent(content) {
    return content.includes('import React') ||
           content.includes('from "react"') ||
           content.includes('from \'react\'') ||
           content.includes('jsx') ||
           content.includes('return (') ||
           content.includes('useState') ||
           content.includes('useEffect');
  }

  /**
   * Extract component props from PropTypes or TypeScript interfaces
   */
  extractProps(content) {
    const props = [];

    // Look for PropTypes
    const propTypesMatch = content.match(/\.propTypes\s*=\s*{([\s\S]*?)}/);
    if (propTypesMatch) {
      const propTypesContent = propTypesMatch[1];
      const propMatches = propTypesContent.matchAll(/(\w+):\s*PropTypes\.(\w+)(?:\.isRequired)?/g);
      for (const match of propMatches) {
        props.push({
          name: match[1],
          type: match[2],
          required: match[0].includes('isRequired')
        });
      }
    }

    // Look for TypeScript interfaces
    const interfaceMatch = content.match(/interface\s+\w*Props\s*{([\s\S]*?)}/);
    if (interfaceMatch) {
      const interfaceContent = interfaceMatch[1];
      const propMatches = interfaceContent.matchAll(/(\w+)(\?)?\s*:\s*([^;,\n]+)/g);
      for (const match of propMatches) {
        props.push({
          name: match[1],
          type: match[3].trim(),
          required: !match[2] // No ? means required
        });
      }
    }

    return props;
  }

  /**
   * Extract React hooks usage
   */
  extractHooks(content) {
    const hooks = [];
    const hookPattern = /use\w+/g;
    let match;
    while ((match = hookPattern.exec(content)) !== null) {
      if (!hooks.includes(match[0])) {
        hooks.push(match[0]);
      }
    }
    return hooks;
  }

  /**
   * Extract import statements
   */
  extractImports(content) {
    const imports = [];
    const importPattern = /import\s+(?:{[^}]+}|\w+|[^}]+)\s+from\s+['"`]([^'"`]+)['"`]/g;
    let match;
    while ((match = importPattern.exec(content)) !== null) {
      imports.push(match[1]);
    }
    return imports;
  }

  /**
   * Parse JSDoc comment
   */
  parseJSDoc(content) {
    const lines = content.split('\n').map(line => line.replace(/^\s*\*\s?/, '').trim());
    const description = [];
    const tags = {};

    let currentTag = null;
    for (const line of lines) {
      if (line.startsWith('@')) {
        const tagMatch = line.match(/@(\w+)\s*(.*)/);
        if (tagMatch) {
          currentTag = tagMatch[1];
          tags[currentTag] = tagMatch[2];
        }
      } else if (currentTag) {
        tags[currentTag] += ' ' + line;
      } else if (line) {
        description.push(line);
      }
    }

    return {
      description: description.join(' '),
      tags: tags
    };
  }

  /**
   * Extract description from JSDoc or comments
   */
  extractDescription(content, jsdocs) {
    let description = '';

    if (jsdocs.length > 0) {
      description = jsdocs[0].description;
    } else {
      // Look for file-level comment
      const fileCommentMatch = content.match(/\/\*\*?\s*\n\s*\*\s*([^\n]+)/);
      if (fileCommentMatch) {
        description = fileCommentMatch[1];
      }
    }

    // Sanitize description for YAML frontmatter
    return description
      .replace(/"/g, '\\"')  // Escape quotes
      .replace(/\n/g, ' ')   // Replace newlines with spaces
      .trim();
  }

  /**
   * Generate API reference documentation
   */
  async generateApiDocs() {
    // Generate main API index
    const apiIndexContent = `---
title: "API Reference"
description: "Complete API documentation generated from source code"
---

# API Reference

This documentation is automatically generated from the Redstring source code.

<Note>
**Developer terminology**: This section uses code-level terms (nodes, graphs) as it documents the actual API. For user-facing concepts, see the [Things and Webs](/concepts/things-and-webs) guide.
</Note>

## Core Classes

<CardGroup cols={2}>
${this.extractedData.classes.map(cls => `  <Card title="${cls.name}" href="/api/${cls.name.toLowerCase()}">
    ${cls.description || `${cls.name} class documentation`}
  </Card>`).join('\n')}
</CardGroup>

## Services

<CardGroup cols={2}>
${this.extractedData.services.map(service => `  <Card title="${service.name}" href="/api/${service.name.toLowerCase()}">
    ${service.description || `${service.name} service documentation`}
  </Card>`).join('\n')}
</CardGroup>

## Components

<CardGroup cols={2}>
${this.extractedData.components.map(comp => `  <Card title="${comp.name}" href="/components/${comp.name.toLowerCase()}">
    ${comp.description || `${comp.name} component documentation`}
  </Card>`).join('\n')}
</CardGroup>

---

*This documentation is automatically generated from source code. Last updated: ${new Date().toISOString()}*
`;

    await this.writeDocFile('api-reference/introduction.mdx', apiIndexContent);
  }

  /**
   * Generate component documentation
   */
  async generateComponentDocs() {
    for (const component of this.extractedData.components) {
      const content = `---
title: "${component.name}"
description: "React component: ${component.description || component.name}"
---

# ${component.name}

${component.description || `The ${component.name} component.`}

## Location
\`${component.filePath}\`

## Props

${component.props.length > 0 ? `
| Prop | Type | Required | Description |
|------|------|----------|-------------|
${component.props.map(prop => `| ${prop.name} | \`${prop.type}\` | ${prop.required ? '✅' : '❌'} | - |`).join('\n')}
` : 'This component does not accept props.'}

## Hooks Used

${component.hooks.length > 0 ? component.hooks.map(hook => `- \`${hook}\``).join('\n') : 'No React hooks detected.'}

## Dependencies

${component.imports.length > 0 ? component.imports.map(imp => `- \`${imp}\``).join('\n') : 'No imports detected.'}

---

*Auto-generated from source code*
`;

      await this.writeDocFile(`components/${component.name.toLowerCase()}.mdx`, content);
    }
  }

  /**
   * Generate service documentation
   */
  async generateServiceDocs() {
    for (const service of this.extractedData.services) {
      const content = `---
title: "${service.name}"
description: "Service: ${service.description || service.name}"
---

# ${service.name}

${service.description || `The ${service.name} service.`}

## Location
\`${service.filePath}\`

## Functions

${service.functions.length > 0 ? service.functions.map(func => `
### ${func.name}

\`\`\`javascript
${func.signature}
\`\`\`

${func.description || 'No description available.'}
`).join('\n') : 'No functions detected.'}

---

*Auto-generated from source code*
`;

      await this.writeDocFile(`api/${service.name.toLowerCase()}.mdx`, content);
    }
  }

  /**
   * Extract store state properties
   */
  extractStoreState(content) {
    const stateProperties = [];
    // Look for properties in the store object
    const storeMatch = content.match(/create\(\s*\([^)]*\)\s*=>\s*\({([^}]+)}/);
    if (storeMatch) {
      const storeContent = storeMatch[1];
      const propMatches = storeContent.matchAll(/(\w+):\s*([^,\n]+)/g);
      for (const match of propMatches) {
        stateProperties.push({
          name: match[1],
          defaultValue: match[2].trim()
        });
      }
    }
    return stateProperties;
  }

  /**
   * Extract store actions
   */
  extractStoreActions(content) {
    const actions = [];
    const actionPattern = /(\w+):\s*\([^)]*\)\s*=>\s*{/g;
    let match;
    while ((match = actionPattern.exec(content)) !== null) {
      actions.push({
        name: match[1],
        signature: match[0]
      });
    }
    return actions;
  }

  /**
   * Extract selectors (functions that use get())
   */
  extractStoreSelectors(content) {
    const selectors = [];
    // This would need more sophisticated parsing
    return selectors;
  }

  /**
   * Extract exports from a module
   */
  extractExports(content) {
    const exports = [];
    const exportPattern = /export\s+(?:const|function|class)\s+(\w+)/g;
    let match;
    while ((match = exportPattern.exec(content)) !== null) {
      exports.push(match[1]);
    }
    return exports;
  }

  /**
   * Extract top-level functions
   */
  extractTopLevelFunctions(content) {
    const functions = [];
    const functionPattern = /(?:export\s+)?(?:const\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)\s*=>|function)|function\s+(\w+)\s*\()/g;
    let match;
    while ((match = functionPattern.exec(content)) !== null) {
      const name = match[1] || match[2];
      functions.push({
        name: name,
        signature: match[0]
      });
    }
    return functions;
  }

  /**
   * Extract class methods
   */
  extractMethods(classContent) {
    const methods = [];
    const methodPattern = /(\w+)\s*\([^)]*\)\s*{/g;
    let match;
    while ((match = methodPattern.exec(classContent)) !== null) {
      methods.push({
        name: match[1],
        signature: match[0]
      });
    }
    return methods;
  }

  /**
   * Extract class properties
   */
  extractProperties(classContent) {
    const properties = [];
    const propertyPattern = /this\.(\w+)\s*=/g;
    let match;
    while ((match = propertyPattern.exec(classContent)) !== null) {
      if (!properties.includes(match[1])) {
        properties.push(match[1]);
      }
    }
    return properties;
  }

  /**
   * Find JSDoc for a specific symbol
   */
  findJSDocForSymbol(symbolName, jsdocs) {
    for (const jsdoc of jsdocs) {
      if (jsdoc.description.includes(symbolName)) {
        return jsdoc.description;
      }
    }
    return '';
  }

  /**
   * Write documentation file
   */
  async writeDocFile(relativePath, content) {
    const fullPath = path.join(docsDir, relativePath);
    const dir = path.dirname(fullPath);

    // Ensure directory exists
    fs.mkdirSync(dir, { recursive: true });

    // Write file
    fs.writeFileSync(fullPath, content, 'utf-8');
    console.log(`📄 Generated: ${relativePath}`);
  }
}

// Run the generator
const generator = new DocumentationGenerator();
generator.generate().catch(console.error);