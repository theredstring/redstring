/**
 * Tabular data parsing layer.
 * Handles CSV, TSV, XLSX, and JSON (array-of-objects) formats.
 * Zero dependency on wizard/graph systems — designed for reuse by future UI import features.
 */

// ─── Lazy imports (avoid bundle bloat) ───────────────────────────────

let Papa = null;
let XLSX = null;

async function loadPapaparse() {
  if (!Papa) {
    Papa = (await import('papaparse')).default;
  }
  return Papa;
}

async function loadXLSX() {
  if (!XLSX) {
    XLSX = (await import('xlsx')).default || (await import('xlsx'));
  }
  return XLSX;
}

// ─── Constants ───────────────────────────────────────────────────────

const LARGE_FILE_THRESHOLD = 200;
const MAX_PARSE_ROWS = 5000;

const EDGE_SOURCE_PATTERNS = /^(source|from|subject|node[_\s]?1|start|head|parent)$/i;
const EDGE_TARGET_PATTERNS = /^(target|to|object|node[_\s]?2|end|tail|child)$/i;
const EDGE_LABEL_PATTERNS = /^(relationship|relation|type|label|edge[_\s]?type|predicate|connection)$/i;
const FK_PATTERNS = /(_id|Id|_ref|_key)$/;

// ─── Entry point ─────────────────────────────────────────────────────

/**
 * Parse a File object into structured tabular data.
 * @param {File} file - Browser File object
 * @param {Object} [options]
 * @param {string} [options.sheetName] - For XLSX: which sheet to parse
 * @param {number} [options.maxRows] - Max rows to parse (default: 5000)
 * @returns {Promise<ParsedTabularData>}
 */
export async function parseTabularFile(file, options = {}) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const maxRows = options.maxRows || MAX_PARSE_ROWS;

  if (ext === 'xlsx' || ext === 'xls') {
    const buffer = await file.arrayBuffer();
    return parseXLSXBuffer(buffer, { ...options, filename: file.name, maxRows });
  }

  const text = await readFileText(file);

  if (ext === 'tsv') {
    return parseCSVText(text, { delimiter: '\t', filename: file.name, maxRows });
  }
  if (ext === 'csv') {
    return parseCSVText(text, { filename: file.name, maxRows });
  }
  if (ext === 'json') {
    return parseJSONText(text, { filename: file.name, maxRows });
  }

  // Fallback: try CSV auto-detect
  return parseCSVText(text, { filename: file.name, maxRows });
}

// ─── Format-specific parsers ─────────────────────────────────────────

/**
 * Parse CSV/TSV text using papaparse.
 * @param {string} text
 * @param {Object} [options]
 * @returns {Promise<ParsedTabularData>}
 */
export async function parseCSVText(text, options = {}) {
  const Papa = await loadPapaparse();
  const maxRows = options.maxRows || MAX_PARSE_ROWS;

  const result = Papa.parse(text, {
    header: true,
    delimiter: options.delimiter || undefined, // auto-detect if not specified
    skipEmptyLines: true,
    dynamicTyping: true,
    preview: maxRows,
  });

  const columns = result.meta.fields || [];
  const rows = result.data || [];

  // Count total rows (approximate for large files)
  const totalLines = text.split('\n').length - 1; // -1 for header
  const totalRows = rows.length < maxRows ? rows.length : totalLines;

  const parsed = {
    filename: options.filename || 'data.csv',
    format: options.delimiter === '\t' ? 'tsv' : 'csv',
    columns,
    rows,
    totalRows,
    isSampled: rows.length < totalRows,
    metadata: {
      detectedDelimiter: result.meta.delimiter,
      errors: result.errors.length > 0 ? result.errors.slice(0, 5) : [],
    },
    profile: null,
  };

  parsed.profile = profileData(parsed);
  return parsed;
}

/**
 * Parse an XLSX ArrayBuffer.
 * @param {ArrayBuffer} buffer
 * @param {Object} [options]
 * @returns {Promise<ParsedTabularData>}
 */
export async function parseXLSXBuffer(buffer, options = {}) {
  const xlsx = await loadXLSX();
  const maxRows = options.maxRows || MAX_PARSE_ROWS;

  const workbook = xlsx.read(buffer, { type: 'array', sheetRows: maxRows + 1 }); // +1 for header
  const sheetNames = workbook.SheetNames;
  const targetSheet = options.sheetName || sheetNames[0];

  if (!workbook.Sheets[targetSheet]) {
    throw new Error(`Sheet "${targetSheet}" not found. Available: ${sheetNames.join(', ')}`);
  }

  const sheet = workbook.Sheets[targetSheet];
  const jsonData = xlsx.utils.sheet_to_json(sheet, { defval: null });
  const rows = jsonData.slice(0, maxRows);
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  // Estimate total rows from sheet range
  const range = xlsx.utils.decode_range(sheet['!ref'] || 'A1');
  const totalRows = range.e.r; // 0-indexed last row (row 0 = header)

  const parsed = {
    filename: options.filename || 'data.xlsx',
    format: 'xlsx',
    columns,
    rows,
    totalRows: Math.max(rows.length, totalRows),
    isSampled: rows.length < totalRows,
    metadata: {
      sheetNames,
      activeSheet: targetSheet,
      sheetCount: sheetNames.length,
    },
    profile: null,
  };

  parsed.profile = profileData(parsed);
  return parsed;
}

/**
 * Parse JSON text (expects array of objects).
 * @param {string} text
 * @param {Object} [options]
 * @returns {ParsedTabularData}
 */
export function parseJSONText(text, options = {}) {
  const maxRows = options.maxRows || MAX_PARSE_ROWS;
  let data;

  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }

  if (!Array.isArray(data)) {
    // Try to find an array property at the top level
    const arrayKey = Object.keys(data).find(k => Array.isArray(data[k]));
    if (arrayKey) {
      data = data[arrayKey];
    } else {
      throw new Error('JSON must be an array of objects, or contain a top-level array property.');
    }
  }

  if (data.length === 0) {
    return {
      filename: options.filename || 'data.json',
      format: 'json',
      columns: [],
      rows: [],
      totalRows: 0,
      isSampled: false,
      metadata: {},
      profile: { columnTypes: {}, uniqueCounts: {}, nullCounts: {}, sampleValues: {} },
    };
  }

  // Validate array of objects
  if (typeof data[0] !== 'object' || data[0] === null) {
    throw new Error('JSON array must contain objects (not primitives).');
  }

  const totalRows = data.length;
  const rows = data.slice(0, maxRows);

  // Collect all unique keys across rows
  const columnSet = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      columnSet.add(key);
    }
  }
  const columns = [...columnSet];

  const parsed = {
    filename: options.filename || 'data.json',
    format: 'json',
    columns,
    rows,
    totalRows,
    isSampled: rows.length < totalRows,
    metadata: {},
    profile: null,
  };

  parsed.profile = profileData(parsed);
  return parsed;
}

// ─── Data profiling ──────────────────────────────────────────────────

/**
 * Profile parsed data: infer column types, count uniques/nulls, collect sample values.
 * @param {ParsedTabularData} parsed
 * @returns {Object} profile
 */
export function profileData(parsed) {
  const { columns, rows } = parsed;
  const columnTypes = {};
  const uniqueCounts = {};
  const nullCounts = {};
  const sampleValues = {};

  for (const col of columns) {
    const values = rows.map(r => r[col]);
    const nonNull = values.filter(v => v != null && v !== '');
    const uniqueSet = new Set(nonNull.map(v => String(v)));

    nullCounts[col] = values.length - nonNull.length;
    uniqueCounts[col] = uniqueSet.size;

    // Sample up to 5 unique values
    sampleValues[col] = [...uniqueSet].slice(0, 5);

    // Infer type from non-null values
    if (nonNull.length === 0) {
      columnTypes[col] = 'empty';
    } else {
      const types = new Set(nonNull.map(v => {
        if (typeof v === 'number') return 'number';
        if (typeof v === 'boolean') return 'boolean';
        // Check if string looks numeric
        if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return 'number';
        return 'string';
      }));
      columnTypes[col] = types.size === 1 ? [...types][0] : 'mixed';
    }
  }

  return { columnTypes, uniqueCounts, nullCounts, sampleValues };
}

// ─── Data shape detection ────────────────────────────────────────────

/**
 * Heuristically detect the data shape.
 * @param {ParsedTabularData} parsed
 * @returns {{ shape: string, confidence: number, details: Object }}
 */
export function detectDataShape(parsed) {
  const { columns, rows, profile } = parsed;
  if (!columns.length || !rows.length) {
    return { shape: 'entity_list', confidence: 0.5, details: {} };
  }

  // Check for edge list pattern
  const sourceCol = columns.find(c => EDGE_SOURCE_PATTERNS.test(c));
  const targetCol = columns.find(c => EDGE_TARGET_PATTERNS.test(c));
  const labelCol = columns.find(c => EDGE_LABEL_PATTERNS.test(c));

  if (sourceCol && targetCol) {
    return {
      shape: 'edge_list',
      confidence: 0.9,
      details: { sourceColumn: sourceCol, targetColumn: targetCol, labelColumn: labelCol || null },
    };
  }

  // Check for adjacency matrix pattern
  // First column is labels, rest are numeric with column headers matching some row values
  if (columns.length > 2 && profile) {
    const firstCol = columns[0];
    const restCols = columns.slice(1);
    const allRestNumeric = restCols.every(c => profile.columnTypes[c] === 'number');
    const firstColValues = new Set(rows.map(r => String(r[firstCol])));
    const headerOverlap = restCols.filter(c => firstColValues.has(c));

    if (allRestNumeric && headerOverlap.length >= restCols.length * 0.5) {
      return {
        shape: 'adjacency_matrix',
        confidence: 0.85,
        details: { labelColumn: firstCol, entityColumns: restCols },
      };
    }
  }

  // Check for relational pattern (foreign key columns)
  if (profile) {
    const fkColumns = columns.filter(c => FK_PATTERNS.test(c));
    // Also check if any column's values are a subset of another column's values
    const crossRefColumns = [];
    for (const col of columns) {
      if (profile.columnTypes[col] !== 'string') continue;
      const colValues = new Set(rows.map(r => r[col]).filter(v => v != null));
      for (const otherCol of columns) {
        if (otherCol === col) continue;
        const otherValues = new Set(rows.map(r => r[otherCol]).filter(v => v != null));
        // If >50% of col values appear in otherCol values, it's likely a reference
        const overlap = [...colValues].filter(v => otherValues.has(v)).length;
        if (colValues.size > 0 && overlap / colValues.size > 0.5 && overlap > 2) {
          crossRefColumns.push({ column: col, referencesColumn: otherCol });
        }
      }
    }

    if (fkColumns.length > 0 || crossRefColumns.length > 0) {
      return {
        shape: 'relational',
        confidence: 0.7,
        details: { foreignKeyColumns: fkColumns, crossReferences: crossRefColumns },
      };
    }
  }

  // Default: entity list
  return { shape: 'entity_list', confidence: 0.6, details: {} };
}

// ─── Suggested mapping ───────────────────────────────────────────────

/**
 * Generate a suggested column-to-graph mapping based on data shape.
 * @param {ParsedTabularData} parsed
 * @param {{ shape: string, details: Object }} shapeInfo
 * @returns {Object} suggested mapping
 */
export function suggestMapping(parsed, shapeInfo) {
  const { columns, profile } = parsed;

  if (shapeInfo.shape === 'edge_list') {
    return {
      dataShape: 'edge_list',
      sourceColumn: shapeInfo.details.sourceColumn,
      targetColumn: shapeInfo.details.targetColumn,
      edgeLabelColumn: shapeInfo.details.labelColumn,
    };
  }

  if (shapeInfo.shape === 'adjacency_matrix') {
    return {
      dataShape: 'adjacency_matrix',
      labelColumn: shapeInfo.details.labelColumn,
    };
  }

  // Entity list or relational: find best name/description/group columns
  const nameCol = findBestNameColumn(columns, profile);
  const descCols = findDescriptionColumns(columns, profile, nameCol);
  const groupCol = findGroupColumn(columns, profile, nameCol);

  const mapping = {
    dataShape: shapeInfo.shape,
    nodeNameColumn: nameCol,
    nodeDescriptionColumns: descCols,
  };

  if (groupCol) mapping.groupByColumn = groupCol;

  if (shapeInfo.shape === 'relational' && shapeInfo.details.crossReferences?.length > 0) {
    mapping.foreignKeyMappings = shapeInfo.details.crossReferences.map(ref => ({
      column: ref.column,
      edgeLabel: ref.column.replace(/_id$/i, '').replace(/Id$/, ''),
    }));
  }

  return mapping;
}

/**
 * Find the most likely "name" column.
 */
function findBestNameColumn(columns, profile) {
  // Prefer columns named "name", "title", "label"
  const namePatterns = /^(name|title|label|entity|item|node)$/i;
  const nameCol = columns.find(c => namePatterns.test(c));
  if (nameCol) return nameCol;

  // Fallback: string column with highest uniqueness ratio
  let bestCol = columns[0];
  let bestRatio = 0;
  for (const col of columns) {
    if (profile?.columnTypes[col] !== 'string') continue;
    const unique = profile?.uniqueCounts[col] || 0;
    const total = profile ? (profile.uniqueCounts[col] || 0) : 0;
    if (unique > bestRatio) {
      bestRatio = unique;
      bestCol = col;
    }
  }
  return bestCol;
}

/**
 * Find columns suitable for node descriptions.
 */
function findDescriptionColumns(columns, profile, nameCol) {
  const descPatterns = /^(description|desc|bio|summary|notes|details|about|text|content)$/i;
  const explicit = columns.filter(c => descPatterns.test(c));
  if (explicit.length > 0) return explicit;

  // Fallback: string columns that aren't the name and aren't IDs
  return columns.filter(c =>
    c !== nameCol &&
    profile?.columnTypes[c] === 'string' &&
    !FK_PATTERNS.test(c) &&
    !/^(id|key|index)$/i.test(c)
  ).slice(0, 3);
}

/**
 * Find the best column for grouping.
 */
function findGroupColumn(columns, profile, nameCol) {
  const groupPatterns = /^(category|group|type|class|department|kind|genre|sector|region|status)$/i;
  const groupCol = columns.find(c => groupPatterns.test(c) && c !== nameCol);
  if (groupCol) return groupCol;

  // Fallback: string column with low cardinality (2-20 unique values)
  for (const col of columns) {
    if (col === nameCol) continue;
    if (profile?.columnTypes[col] !== 'string') continue;
    const unique = profile?.uniqueCounts[col] || 0;
    if (unique >= 2 && unique <= 20) return col;
  }
  return null;
}

// ─── LLM Summary ────────────────────────────────────────────────────

/**
 * Build a structured markdown summary for the LLM context.
 * @param {ParsedTabularData} parsed
 * @param {number} [maxSampleRows=5]
 * @returns {string}
 */
export function buildLLMSummary(parsed, maxSampleRows = 5) {
  const { filename, format, columns, rows, totalRows, profile, metadata } = parsed;
  const shapeInfo = detectDataShape(parsed);
  const mapping = suggestMapping(parsed, shapeInfo);

  const lines = [];
  lines.push(`## Tabular Data: ${filename}`);
  lines.push(`Format: ${format.toUpperCase()} | ${totalRows} rows x ${columns.length} columns`);
  if (parsed.isSampled) {
    lines.push(`(Showing first ${rows.length} of ${totalRows} rows — full data available to tools)`);
  }
  if (metadata?.sheetNames) {
    lines.push(`Sheets: ${metadata.sheetNames.join(', ')} (active: ${metadata.activeSheet})`);
  }
  lines.push('');

  // Column table
  lines.push('### Columns');
  lines.push('| Column | Type | Unique | Nulls | Sample Values |');
  lines.push('|--------|------|--------|-------|---------------|');
  for (const col of columns) {
    const type = profile?.columnTypes[col] || '?';
    const unique = profile?.uniqueCounts[col] ?? '?';
    const nulls = profile?.nullCounts[col] ?? '?';
    const samples = (profile?.sampleValues[col] || []).slice(0, 3).map(v => JSON.stringify(v)).join(', ');
    lines.push(`| ${col} | ${type} | ${unique} | ${nulls} | ${samples} |`);
  }
  lines.push('');

  // Data shape detection
  lines.push(`### Detected Data Shape: ${shapeInfo.shape} (confidence: ${(shapeInfo.confidence * 100).toFixed(0)}%)`);
  if (shapeInfo.shape === 'edge_list') {
    lines.push(`- Source column: "${shapeInfo.details.sourceColumn}"`);
    lines.push(`- Target column: "${shapeInfo.details.targetColumn}"`);
    if (shapeInfo.details.labelColumn) lines.push(`- Label column: "${shapeInfo.details.labelColumn}"`);
  } else if (shapeInfo.shape === 'adjacency_matrix') {
    lines.push(`- Row labels: "${shapeInfo.details.labelColumn}"`);
    lines.push(`- Entity columns: ${shapeInfo.details.entityColumns.length}`);
  } else {
    lines.push(`- Suggested name column: "${mapping.nodeNameColumn}"`);
    if (mapping.nodeDescriptionColumns?.length) {
      lines.push(`- Description columns: ${mapping.nodeDescriptionColumns.map(c => `"${c}"`).join(', ')}`);
    }
    if (mapping.groupByColumn) lines.push(`- Group by: "${mapping.groupByColumn}"`);
    if (mapping.foreignKeyMappings?.length) {
      lines.push(`- Foreign key references: ${mapping.foreignKeyMappings.map(fk => `"${fk.column}"`).join(', ')}`);
    }
  }
  lines.push('');

  // Sample rows
  const sampleCount = Math.min(maxSampleRows, rows.length);
  if (sampleCount > 0) {
    // Decide how many sample rows based on total
    const displayCount = totalRows < 50 ? Math.min(rows.length, 20) : sampleCount;
    lines.push(`### Sample Rows (first ${displayCount})`);
    lines.push('| ' + columns.join(' | ') + ' |');
    lines.push('| ' + columns.map(() => '---').join(' | ') + ' |');
    for (let i = 0; i < displayCount; i++) {
      const row = rows[i];
      const vals = columns.map(c => {
        const v = row[c];
        if (v == null) return '';
        const s = String(v);
        return s.length > 50 ? s.slice(0, 47) + '...' : s;
      });
      lines.push('| ' + vals.join(' | ') + ' |');
    }
    lines.push('');
  }

  lines.push('Use `analyzeTabularData` for full analysis, then `importTabularAsGraph` to convert to a graph.');

  return lines.join('\n');
}

// ─── Sampling ────────────────────────────────────────────────────────

/**
 * Return a representative sample of rows.
 * @param {ParsedTabularData} parsed
 * @param {number} [maxRows=50]
 * @returns {Object[]}
 */
export function sampleRows(parsed, maxRows = 50) {
  if (parsed.rows.length <= maxRows) return parsed.rows;
  // Take first few + evenly spaced rows for representation
  const firstCount = Math.min(5, maxRows);
  const rest = maxRows - firstCount;
  const step = Math.floor((parsed.rows.length - firstCount) / rest);
  const sampled = parsed.rows.slice(0, firstCount);
  for (let i = firstCount; i < parsed.rows.length && sampled.length < maxRows; i += step) {
    sampled.push(parsed.rows[i]);
  }
  return sampled;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });
}
