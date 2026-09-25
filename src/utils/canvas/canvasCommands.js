import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Canvas command registry (P2.08, D-20).
 *
 * UI outside the canvas (Header now; the Panels and hosts next) asks the canvas
 * to act by name: `runCanvasCommand('autoLayout')`. That replaces callbacks
 * passed down from NodeCanvas, which tie the receiver's renders to NodeCanvas's,
 * and new window events, which are global and untyped.
 *
 * NodeCanvas registers its handlers while it is mounted. With no handler
 * registered (the canvas isn't mounted) a command does nothing and returns
 * undefined.
 */
const handlers = new Map();

/**
 * Register handlers by name. Returns an unregister function that removes only
 * the handlers this call added, so a newer registration under the same name
 * survives an older one's cleanup.
 * @param {Record<string, Function>} map
 * @returns {() => void}
 */
export function registerCanvasCommands(map) {
  const entries = Object.entries(map);
  for (const [name, fn] of entries) handlers.set(name, fn);
  return () => {
    for (const [name, fn] of entries) {
      if (handlers.get(name) === fn) handlers.delete(name);
    }
  };
}

/**
 * Run a registered command.
 * @param {string} name
 * @param {...any} args
 * @returns {any} the handler's return value, or undefined if none is registered
 */
export function runCanvasCommand(name, ...args) {
  const fn = handlers.get(name);
  return fn ? fn(...args) : undefined;
}

/**
 * Register `commands` for as long as the calling component is mounted.
 *
 * Registered once, on mount. Each registered function forwards to the latest
 * `commands` object, so handlers may close over render state without
 * re-registering every render. The set of names is fixed at mount.
 * @param {Record<string, Function>} commands
 */
export function useCanvasCommands(commands) {
  const latest = useRef(commands);
  useLayoutEffect(() => {
    latest.current = commands;
  });
  useEffect(() => {
    const forwarders = {};
    for (const name of Object.keys(latest.current)) {
      forwarders[name] = (...args) => latest.current[name]?.(...args);
    }
    return registerCanvasCommands(forwarders);
  }, []);
}
