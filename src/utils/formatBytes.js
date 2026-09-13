/**
 * Byte counts as a human reads them.
 *
 * Shared so that a size means the same thing everywhere it appears — the file
 * list in the external link loader and the revision list in Git history are
 * both showing the size of the same kind of object, and a universe that reads
 * "6.6 MB" in one place must not read "6.9 MB" in the other.
 *
 * 1024-based, which is the convention this app already used.
 *
 * @param {number} n
 * @returns {string} '' when there is no size to show, so callers can render it
 *   directly without guarding.
 */
export const formatBytes = (n) => {
  if (!n || n <= 0 || !Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

export default formatBytes;
