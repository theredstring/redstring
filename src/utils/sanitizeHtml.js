/**
 * Central HTML sanitizer for any string passed to `dangerouslySetInnerHTML`.
 *
 * Redstring renders model/LLM output (and other user-influenced text) through
 * regex-based markdown renderers that escape input first. Sanitizing the final
 * HTML with DOMPurify is defense-in-depth: even if a renderer regex is ever
 * bypassed, this strips <script>, inline event handlers (onerror, onclick, …),
 * javascript: URLs, and other XSS vectors before the HTML reaches the DOM.
 */

import DOMPurify from 'dompurify';

/**
 * Sanitize an HTML string for safe injection via dangerouslySetInnerHTML.
 * @param {string} dirty - HTML produced by a renderer (already escaped, but untrusted).
 * @returns {string} Sanitized HTML with dangerous tags/attributes removed.
 */
export function sanitizeHtml(dirty) {
  if (dirty == null) return '';
  return DOMPurify.sanitize(String(dirty), {
    USE_PROFILES: { html: true },
    // Allow links to open in a new tab safely; DOMPurify still blocks
    // javascript:/data: URLs and event-handler attributes.
    ADD_ATTR: ['target', 'rel'],
  });
}

export default sanitizeHtml;
