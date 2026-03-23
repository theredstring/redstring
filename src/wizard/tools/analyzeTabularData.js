/**
 * analyzeTabularData — Read-only wizard tool
 *
 * Analyzes an attached tabular data file and returns structured metadata:
 * column info, data types, sample rows, detected data shape, and suggested mapping.
 *
 * The LLM should call this BEFORE importTabularAsGraph to understand the data.
 */

import { detectDataShape, suggestMapping, sampleRows, profileData } from '../../services/tabularParser.js';

/**
 * @param {Object} args
 * @param {number} [args.fileIndex=0] - Index of the tabular file in attachments
 * @param {string} [args.sheetName] - For XLSX: which sheet to analyze
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @returns {Promise<Object>} Analysis result (no action field — read-only)
 */
export async function analyzeTabularData(args, graphState, cid) {
  const fileIndex = args.fileIndex || 0;

  // Access tabular data from config passthrough
  const tabularData = graphState?._tabularData;
  if (!tabularData || !Array.isArray(tabularData) || tabularData.length === 0) {
    return {
      error: 'No tabular data found. Make sure a CSV, TSV, XLSX, or JSON file is attached to the message.'
    };
  }

  if (fileIndex >= tabularData.length) {
    return {
      error: `File index ${fileIndex} out of range. ${tabularData.length} tabular file(s) available (0-indexed).`
    };
  }

  const parsed = tabularData[fileIndex];

  // Handle XLSX sheet selection
  if (args.sheetName && parsed.format === 'xlsx' && parsed.metadata?.sheetNames) {
    if (!parsed.metadata.sheetNames.includes(args.sheetName)) {
      return {
        error: `Sheet "${args.sheetName}" not found. Available sheets: ${parsed.metadata.sheetNames.join(', ')}`
      };
    }
    // If requesting a different sheet than what was parsed, note it
    if (parsed.metadata.activeSheet !== args.sheetName) {
      return {
        warning: `Sheet "${args.sheetName}" requested but "${parsed.metadata.activeSheet}" was parsed. Re-attach the file or specify the sheet when uploading.`,
        availableSheets: parsed.metadata.sheetNames,
        activeSheet: parsed.metadata.activeSheet
      };
    }
  }

  // Run analysis
  const profile = parsed.profile || profileData(parsed);
  const shapeInfo = detectDataShape(parsed);
  const mapping = suggestMapping(parsed, shapeInfo);
  const sample = sampleRows(parsed, 10);

  const result = {
    filename: parsed.filename,
    format: parsed.format,
    totalRows: parsed.totalRows,
    totalColumns: parsed.columns.length,
    columns: parsed.columns,
    columnTypes: profile.columnTypes,
    uniqueCounts: profile.uniqueCounts,
    nullCounts: profile.nullCounts,
    sampleValues: profile.sampleValues,
    sampleRows: sample.slice(0, 10),
    isSampled: parsed.isSampled,

    // Data shape analysis
    detectedDataShape: shapeInfo.shape,
    shapeConfidence: shapeInfo.confidence,
    shapeDetails: shapeInfo.details,

    // Suggested mapping for importTabularAsGraph
    suggestedMapping: mapping,
  };

  // Include XLSX-specific metadata
  if (parsed.format === 'xlsx' && parsed.metadata) {
    result.sheets = parsed.metadata.sheetNames;
    result.activeSheet = parsed.metadata.activeSheet;
    result.sheetCount = parsed.metadata.sheetCount;
  }

  // Include potential column classifications
  const potentialNameCols = parsed.columns.filter(c =>
    /^(name|title|label|entity|item|node)$/i.test(c)
  );
  const potentialIdCols = parsed.columns.filter(c =>
    /^(id|key|index|_id)$/i.test(c) || profile.columnTypes[c] === 'number' && profile.uniqueCounts[c] === parsed.rows.length
  );
  const potentialCategoryCols = parsed.columns.filter(c => {
    const unique = profile.uniqueCounts[c] || 0;
    return profile.columnTypes[c] === 'string' && unique >= 2 && unique <= 20;
  });

  result.potentialNameColumns = potentialNameCols;
  result.potentialIdColumns = potentialIdCols;
  result.potentialCategoryColumns = potentialCategoryCols;

  // File listing if multiple files
  if (tabularData.length > 1) {
    result.availableFiles = tabularData.map((f, i) => ({
      index: i,
      filename: f.filename,
      format: f.format,
      rows: f.totalRows,
      columns: f.columns.length
    }));
  }

  return result;
}
