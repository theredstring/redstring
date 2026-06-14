#!/usr/bin/env node
/**
 * schema-report (P0.4) — diagnostic lens for .redstring files.
 *
 * Usage: node scripts/schema-report.js <file.redstring>
 *
 * Prints a one-screen, non-destructive report about a universe file: its
 * detected format version, the migration path it would take, entity counts,
 * quarantine (`_preserved`) bag count, whether it carries duplicate top-level
 * sections (the triple-redundancy the v4 refactor removes), and file size.
 *
 * Read-only. Runs in plain Node (no browser globals). Imports the real format
 * handler so the reported version detection matches what the app actually does.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validateFormatVersion,
  CURRENT_FORMAT_VERSION
} from '../src/formats/redstringFormat.js';

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node scripts/schema-report.js <file.redstring>');
  process.exit(1);
}

const filePath = resolve(process.cwd(), arg);

let raw;
try {
  raw = readFileSync(filePath, 'utf8');
} catch (error) {
  console.error(`Could not read file: ${error.message}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(raw);
} catch (error) {
  console.error(`File is not valid JSON: ${error.message}`);
  process.exit(1);
}

const sizeOf = (obj) => (obj && typeof obj === 'object' ? Object.keys(obj).length : 0);

// Resolve the canonical sections, tolerating every historical shape.
const prototypes =
  data.prototypeSpace?.prototypes || data.nodePrototypes || data.legacy?.nodePrototypes || {};
const graphs =
  data.spatialGraphs?.graphs || data.graphs || data.legacy?.graphs || {};
const edges =
  data.relationships?.edges || data.edges || data.legacy?.edges || {};

// Instances live inside each graph (either `redstring:instances` or `instances`).
let instanceCount = 0;
for (const graph of Object.values(graphs)) {
  instanceCount += sizeOf(graph?.['redstring:instances'] || graph?.instances);
}

// Count every `_preserved` quarantine bag anywhere in the document (pre-Phase 1
// there are usually zero; this number is the inventory the risk register tracks).
let preservedBags = 0;
const walk = (node) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(walk);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '_preserved' && value && typeof value === 'object') preservedBags += 1;
    else walk(value);
  }
};
walk(data);

const validation = validateFormatVersion(data);

// Duplicate / redundant top-level sections the v4 refactor (P1.5) removes.
const hasCanonical = !!(data.prototypeSpace || data.spatialGraphs);
const duplicateSections = [];
if (hasCanonical && data.nodePrototypes) duplicateSections.push('nodePrototypes');
if (hasCanonical && data.graphs) duplicateSections.push('graphs');
if (hasCanonical && data.edges) duplicateSections.push('edges');
if (data.legacy) duplicateSections.push('legacy');

// Migration path. Until the P1.1 ledger lands, the app uses the monolithic
// migrateFormat() relabeler, so report that rather than inventing ledger steps.
let migrationPath;
if (!validation.valid && validation.tooOld) {
  migrationPath = `unsupported (too old — below minimum)`;
} else if (!validation.valid && validation.tooNew) {
  migrationPath = `unsupported (newer than this app's ${CURRENT_FORMAT_VERSION})`;
} else if (validation.needsMigration) {
  migrationPath = `${validation.version} → ${CURRENT_FORMAT_VERSION} (legacy migrateFormat)`;
} else {
  migrationPath = `none (already ${CURRENT_FORMAT_VERSION})`;
}

const bytes = Buffer.byteLength(raw, 'utf8');
const humanSize =
  bytes < 1024 ? `${bytes} B`
  : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB`
  : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

console.log(`
schema-report: ${filePath}
${'─'.repeat(60)}
  format field        ${data.format || '(none)'}
  detected version    ${validation.version}${validation.valid ? '' : '  (INVALID)'}
  migration path      ${migrationPath}
${'─'.repeat(60)}
  prototypes          ${sizeOf(prototypes)}
  graphs              ${sizeOf(graphs)}
  instances           ${instanceCount}
  edges               ${sizeOf(edges)}
  _preserved bags     ${preservedBags}
${'─'.repeat(60)}
  duplicate sections  ${duplicateSections.length ? duplicateSections.join(', ') : 'none'}
  file size           ${humanSize}
`);
