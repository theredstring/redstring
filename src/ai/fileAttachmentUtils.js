/**
 * File attachment utilities for the AI chat panel.
 * Handles file reading, validation, and content block building
 * for multi-provider multimodal message support.
 */

import { parseTabularFile, buildLLMSummary } from '../services/tabularParser.js';
import { storeTabularData } from '../services/tabularDataStore.js';

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
export const SUPPORTED_DOC_TYPES = [
  'text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values',
  'application/json', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
];
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file (PDFs can be larger)

/** Extensions recognized as tabular data */
const TABULAR_EXTENSIONS = ['csv', 'tsv', 'xlsx', 'xls', 'json'];

/**
 * Determine file category from MIME type or extension.
 * @param {File} file
 * @returns {'image' | 'document' | 'unknown'}
 */
export function getFileCategory(file) {
  if (SUPPORTED_IMAGE_TYPES.includes(file.type)) return 'image';
  if (SUPPORTED_DOC_TYPES.includes(file.type)) return 'document';

  // Fallback: check extension for common types browsers may not MIME-type correctly
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
  if (['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'pdf', 'xlsx', 'xls'].includes(ext)) return 'document';

  return 'unknown';
}

/**
 * Check if a file is a tabular data format (CSV, TSV, XLSX, JSON).
 * @param {File} file
 * @returns {boolean}
 */
export function isTabularFile(file) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  return TABULAR_EXTENSIONS.includes(ext);
}

/**
 * Read a file as a data URL (base64).
 * @param {File} file
 * @returns {Promise<string>} data URL string
 */
export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * Read a file as text.
 * @param {File} file
 * @returns {Promise<string>} file text content
 */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });
}

/**
 * Read a PDF file and extract text from all pages.
 * Uses pdfjs-dist loaded lazily to avoid bundle bloat.
 * @param {File} file
 * @returns {Promise<string>} extracted text from all pages
 */
export async function readPdfAsText(file) {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    pages.push(textContent.items.map(item => item.str).join(' '));
  }
  return pages.join('\n\n');
}

/**
 * Read a tabular file (CSV, TSV, XLSX, JSON), parse it, and store the full
 * parsed data for tool access. Returns a structured LLM summary as extractedText.
 *
 * @param {File} file
 * @param {string} attachId - Unique attachment ID for data store keying
 * @returns {Promise<{ extractedText: string, parsedData: Object }>}
 */
export async function readTabularFile(file, attachId) {
  const parsedData = await parseTabularFile(file);

  // Store the full parsed data so wizard tools can access it
  storeTabularData(attachId, parsedData);

  // Build a structured summary for the LLM context (not raw text)
  const extractedText = buildLLMSummary(parsedData);

  return { extractedText, parsedData };
}

/**
 * Extract the raw base64 data from a data URL.
 * "data:image/png;base64,iVBOR..." → "iVBOR..."
 * @param {string} dataUrl
 * @returns {string} raw base64 string
 */
export function extractBase64(dataUrl) {
  const commaIdx = dataUrl.indexOf(',');
  return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
}

/**
 * Build the unified content block array for a message with attachments.
 * This is the intermediate format that gets normalized per-provider in LLMClient.
 *
 * @param {string} text - User's text message
 * @param {Array} attachments - Processed attachments from pendingAttachments state
 * @returns {Array<ContentBlock>} Unified content blocks
 */
export function buildContentBlocks(text, attachments) {
  const blocks = [];

  // Text block first (even if empty, some providers need at least one text block)
  if (text && text.trim()) {
    blocks.push({ type: 'text', text: text.trim() });
  }

  for (const att of attachments) {
    if (att.category === 'image' && att.dataUrl) {
      // Extract MIME type from data URL: "data:image/png;base64,..." → "image/png"
      const mimeMatch = att.dataUrl.match(/^data:(image\/[^;]+);base64,/);
      const mediaType = mimeMatch ? mimeMatch[1] : att.type || 'image/png';
      blocks.push({
        type: 'image',
        media_type: mediaType,
        data: extractBase64(att.dataUrl),
      });
    } else if (att.category === 'document' && att.extractedText != null) {
      blocks.push({
        type: 'document_text',
        filename: att.name,
        text: att.extractedText,
      });
    }
  }

  // If we ended up with no blocks at all, add an empty text block
  if (blocks.length === 0) {
    blocks.push({ type: 'text', text: '' });
  }

  return blocks;
}
