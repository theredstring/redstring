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

// Marker written into every generated file. Used to (a) safely delete stale
// generated pages and (b) avoid clobbering hand-written pages of the same name.
const AUTOGEN_MARKER = 'Auto-generated from source code';

// Output directories that hold generated pages and are safe to prune (only
// files containing AUTOGEN_MARKER are ever deleted).
const generatedDirs = ['api', 'components'];

// Symbol names that are regex false-positives (JS keywords / generic wrappers),
// never real components/services/classes worth documenting.
const NAME_BLOCKLIST = new Set([
  'return', 'produce', 'step', 'default', 'function', 'async', 'await',
  'if', 'for', 'while', 'switch', 'const', 'let', 'var', 'index', 'do'
]);

class DocumentationGenerator {
  constructor() {
    this.extractedData = {
      components: [],
      classes: [],
      functions: [],
      stores: [],
      services: []
    };
    // Pages actually written this run, bucketed for navigation generation.
    // Each entry is a Mintlify page slug (path relative to docs/, no extension).
    this.pages = {
      core: [],
      stores: [],
      services: [],
      components: [],
      utilities: []
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

    console.log('🧹 Removing stale generated pages...');
    this.cleanGeneratedFiles();

    console.log('📝 Generating documentation files...');
    await this.generateApiDocs();
    await this.generateClassDocs();
    await this.generateStoreDocs();
    await this.generateServiceDocs();
    await this.generateComponentDocs();

    console.log('🧭 Updating navigation (docs.json)...');
    this.updateNavigation();

    console.log('✅ Documentation generation complete!');
  }

  /**
   * Delete previously generated pages so renamed/removed modules don't leave
   * orphans. Only files containing AUTOGEN_MARKER are removed, so hand-written
   * pages (e.g. components/nodecanvas.mdx) are preserved.
   */
  cleanGeneratedFiles() {
    for (const dir of generatedDirs) {
      const fullDir = path.join(docsDir, dir);
      if (!fs.existsSync(fullDir)) continue;
      for (const entry of fs.readdirSync(fullDir)) {
        if (!entry.endsWith('.mdx')) continue;
        const filePath = path.join(fullDir, entry);
        try {
          if (fs.readFileSync(filePath, 'utf-8').includes(AUTOGEN_MARKER)) {
            fs.unlinkSync(filePath);
          }
        } catch { /* ignore unreadable files */ }
      }
    }
  }

  /**
   * Record a written page under a navigation bucket (slug = docs-relative path
   * without the .mdx extension, e.g. "api/graph").
   */
  trackPage(bucket, slug) {
    if (!this.pages[bucket].includes(slug)) {
      this.pages[bucket].push(slug);
    }
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
    if (/\.(test|spec)\.[jt]sx?$/.test(filename)) return false;
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
    if (componentMatch && !NAME_BLOCKLIST.has(componentMatch[1]) && this.isReactComponent(content)) {
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
      if (NAME_BLOCKLIST.has(classMatch[1])) continue;
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
      // Prefer explicit body text; fall back to @description tag (used in @module blocks)
      description = jsdocs[0].description || jsdocs[0].tags.description || '';
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
   * Sanitize text for MDX body to prevent parsing errors
   */
  sanitizeForMdx(text) {
    if (!text) return '';
    return text
      .replace(/<([0-9])/g, '\\<$1') // Escape < when followed by a digit
      .replace(/{/g, '\\{')         // Escape { to prevent MDX expression parsing
      .replace(/}/g, '\\}');        // Escape }
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
    ${this.sanitizeForMdx(cls.description) || `${cls.name} class documentation`}
  </Card>`).join('\n')}
</CardGroup>

## Services

<CardGroup cols={2}>
${this.extractedData.services.map(service => `  <Card title="${service.name}" href="/api/${service.name.toLowerCase()}">
    ${this.sanitizeForMdx(service.description) || `${service.name} service documentation`}
  </Card>`).join('\n')}
</CardGroup>

## Components

<CardGroup cols={2}>
${this.extractedData.components.map(comp => `  <Card title="${comp.name}" href="/components/${comp.name.toLowerCase()}">
    ${this.sanitizeForMdx(comp.description) || `${comp.name} component documentation`}
  </Card>`).join('\n')}
</CardGroup>

---

*This documentation is automatically generated from source code. Last updated: ${new Date().toISOString()}*
`;

    await this.writeDocFile('api-reference/introduction.mdx', apiIndexContent);
  }

  /**
   * Generate reference pages for core domain classes (src/core), e.g. Graph,
   * Node, Edge. These aren't services or stores, so they'd otherwise produce no
   * page even though the API index links to them.
   */
  async generateClassDocs() {
    const coreClasses = this.extractedData.classes.filter(cls =>
      cls.filePath.replace(/\\/g, '/').includes('src/core/')
    );

    for (const cls of coreClasses) {
      const description = cls.description || `The \`${cls.name}\` class.`;
      const methods = (cls.methods || []).filter(m => m.name !== 'constructor');

      const content = `---
title: "${cls.name}"
description: "Class: ${this.sanitizeForMdx(description)}"
---

# ${cls.name}${cls.extends ? ` <Badge>extends ${cls.extends}</Badge>` : ''}

${this.sanitizeForMdx(description)}

## Location
\`${cls.filePath.replace(/\\/g, '/')}\`

## Methods

${methods.length > 0 ? methods.map(m => `- \`${m.name}()\``).join('\n') : 'No public methods detected.'}

${(cls.properties && cls.properties.length > 0) ? `## Properties\n\n${cls.properties.map(p => `- \`${p}\``).join('\n')}\n` : ''}
---

*Auto-generated from source code*
`;

      const slug = `api/${cls.name.toLowerCase()}`;
      if (await this.writeDocFile(`${slug}.mdx`, content)) {
        this.trackPage('core', slug);
      }
    }
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

${this.sanitizeForMdx(component.description) || `The ${component.name} component.`}

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

      const slug = `components/${component.name.toLowerCase()}`;
      if (await this.writeDocFile(`${slug}.mdx`, content)) {
        // PascalCase names are true React components; camelCase are helpers.
        const bucket = /^[A-Z]/.test(component.name) ? 'components' : 'utilities';
        this.trackPage(bucket, slug);
      }
    }
  }

  /**
   * Generate service documentation
   */
  async generateServiceDocs() {
    for (const service of this.extractedData.services) {
      const fileContent = fs.readFileSync(service.filePath, 'utf-8');
      const methods = this.extractClassMethodsWithJSDoc(fileContent);
      const description = service.description || `The ${service.name} service.`;

      const mdxContent = `---
title: "${service.name}"
description: "Service: ${this.sanitizeForMdx(description)}"
---

# ${service.name}

${this.sanitizeForMdx(description)}

## Location
\`${service.filePath}\`

## Methods

${methods.length > 0 ? methods.map(method => `
### ${method.name}

${method.description ? this.sanitizeForMdx(method.description) + '\n' : ''}${method.params.length > 0 ? `\n**Parameters:**\n\n${method.params.map(p => `- \`${this.sanitizeForMdx(p)}\``).join('\n')}\n` : ''}${method.returns ? `\n**Returns:** ${this.sanitizeForMdx(method.returns)}\n` : ''}`).join('\n---\n') : 'No methods detected.'}

---

*Auto-generated from source code*
`;

      const slug = `api/${service.name.toLowerCase()}`;
      if (await this.writeDocFile(`${slug}.mdx`, mdxContent)) {
        this.trackPage('services', slug);
      }
    }
  }

  /**
   * Extract public class methods with their JSDoc from file content.
   */
  extractClassMethodsWithJSDoc(content) {
    const results = [];
    // Match a JSDoc block followed by a 2-space-indented method declaration.
    // Uses (?:[^*]|\*(?!\/))*  to prevent spanning across multiple JSDoc blocks.
    const pattern = /\/\*\*((?:[^*]|\*(?!\/))*)\*\/[ \t]*\n[ \t]{2}(?:async\s+)?(\w+)\s*\(/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const jsdocBody = match[1];
      const methodName = match[2];
      if (methodName === 'constructor') continue;
      const lines = jsdocBody.split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim());
      const isPrivate = lines.some(l => l.startsWith('@private'));
      if (isPrivate) continue;
      const descLines = lines.filter(l => l && !l.startsWith('@'));
      const paramLines = lines.filter(l => l.startsWith('@param')).map(l => l.replace('@param', '').trim());
      const returnsLine = lines.find(l => l.startsWith('@returns'));
      results.push({
        name: methodName,
        description: descLines.join(' ').trim(),
        params: paramLines,
        returns: returnsLine ? returnsLine.replace('@returns', '').trim() : null
      });
    }
    return results;
  }

  /**
   * Generate documentation for Zustand stores
   */
  async generateStoreDocs() {
    for (const store of this.extractedData.stores) {
      const fileContent = fs.readFileSync(store.filePath, 'utf-8');
      const actionsWithDocs = this.extractActionsWithJSDoc(fileContent);

      const mdxContent = `---
title: "${store.name}"
description: "Zustand store: ${this.sanitizeForMdx(store.description) || store.name}"
---

# ${store.name}

${this.sanitizeForMdx(store.description) || `The \`${store.name}\` Zustand store.`}

## Location
\`${store.filePath.replace(projectRoot + '/', '')}\`

## Actions

${actionsWithDocs.length > 0 ? actionsWithDocs.map(action => `
### ${action.name}

${action.description ? action.description + '\n' : ''}${action.params.length > 0 ? `\n**Parameters:**\n\n${action.params.map(p => `- \`${p}\``).join('\n')}\n` : ''}${action.returns ? `\n**Returns:** ${action.returns}\n` : ''}`).join('\n---\n') : 'No actions detected.'}

---

*Auto-generated from source code*
`;

      const slug = `api/${store.name.toLowerCase()}`;
      if (await this.writeDocFile(`${slug}.mdx`, mdxContent)) {
        this.trackPage('stores', slug);
      }
    }
  }

  /**
   * Extract actions with their preceding JSDoc descriptions from store content
   */
  extractActionsWithJSDoc(content) {
    const results = [];
    // Match a JSDoc block followed immediately by a 4-space-indented action name.
    // Uses (?:[^*]|\*(?!\/))*  to match content that cannot cross a */ boundary,
    // preventing the engine from spanning multiple JSDoc blocks to find an action.
    const pattern = /\/\*\*((?:[^*]|\*(?!\/))*)\*\/[ \t]*\n[ \t]{4}(\w+)\s*:/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const jsdocBody = match[1];
      const actionName = match[2];
      const lines = jsdocBody.split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim());
      const descLines = lines.filter(l => l && !l.startsWith('@'));
      const paramLines = lines.filter(l => l.startsWith('@param')).map(l => l.replace('@param', '').trim());
      const returnsLine = lines.find(l => l.startsWith('@returns'));
      results.push({
        name: actionName,
        description: descLines.join(' ').trim(),
        params: paramLines,
        returns: returnsLine ? returnsLine.replace('@returns', '').trim() : null
      });
    }
    return results;
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
   * Write a documentation file. Refuses to overwrite hand-written pages (any
   * existing file that lacks AUTOGEN_MARKER), so curated docs are never lost.
   * Returns true if the file was written, false if it was skipped.
   */
  async writeDocFile(relativePath, content) {
    const fullPath = path.join(docsDir, relativePath);
    const dir = path.dirname(fullPath);

    if (fs.existsSync(fullPath)) {
      const existing = fs.readFileSync(fullPath, 'utf-8');
      if (!existing.includes(AUTOGEN_MARKER)) {
        console.log(`⏭️  Skipped (hand-written): ${relativePath}`);
        return false;
      }
    }

    // Ensure directory exists
    fs.mkdirSync(dir, { recursive: true });

    // Write file
    fs.writeFileSync(fullPath, content, 'utf-8');
    console.log(`📄 Generated: ${relativePath}`);
    return true;
  }

  /**
   * Rewrite the "API Reference" tab in docs.json from the pages generated this
   * run. The hand-authored "Guides" tab (and all other config) is left intact.
   */
  updateNavigation() {
    const docsJsonPath = path.join(docsDir, 'docs.json');
    const config = JSON.parse(fs.readFileSync(docsJsonPath, 'utf-8'));

    const groupDefs = [
      { group: 'Core Classes', pages: this.pages.core },
      { group: 'Stores', pages: this.pages.stores },
      { group: 'Services', pages: this.pages.services },
      { group: 'Components', pages: this.pages.components },
      { group: 'Utilities & Functions', pages: this.pages.utilities }
    ];

    const groups = groupDefs
      .filter(g => g.pages.length > 0)
      .map(g => ({ group: g.group, pages: [...g.pages].sort() }));

    const apiTab = { tab: 'API Reference', groups };

    const tabs = config.navigation.tabs;
    const idx = tabs.findIndex(t => t.tab === 'API Reference');
    if (idx >= 0) {
      tabs[idx] = apiTab;
    } else {
      tabs.push(apiTab);
    }

    fs.writeFileSync(docsJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

    const total = groups.reduce((n, g) => n + g.pages.length, 0);
    console.log(`🧭 Navigation updated: ${total} pages across ${groups.length} groups`);
  }
}

// Run the generator
const generator = new DocumentationGenerator();
generator.generate().catch(console.error);