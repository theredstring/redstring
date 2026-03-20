/**
 * MCP stdio safety wrapper.
 *
 * Imported services use console.log for diagnostics, but in the MCP server
 * process stdout IS the stdio transport — any console.log corrupts the protocol.
 * This wrapper temporarily redirects console.log → console.error for the
 * duration of an async function call.
 */
export function withSafeConsole(fn) {
  const origLog = console.log;
  console.log = console.error;
  return fn().finally(() => { console.log = origLog; });
}
