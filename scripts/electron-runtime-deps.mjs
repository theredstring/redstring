#!/usr/bin/env node
/**
 * The packages the desktop app's main process loads from node_modules at run
 * time, and nothing else, for electron-builder.json's `files`.
 *
 * electron-builder packs every package in `dependencies`, but the renderer is
 * bundled by Vite into dist/ and the agent server by esbuild into
 * agent-server.bundle.cjs, so almost none of them are ever loaded from the
 * app: they were ~150 MB of the download. The main process (electron/*.cjs)
 * requires a couple of packages; this follows their dependencies through the
 * installed node_modules and lists every package reached, by name, since
 * electron-builder lifts nested copies to the top of the app's node_modules.
 *
 *   node scripts/electron-runtime-deps.mjs           # print the list
 *   node scripts/electron-runtime-deps.mjs --write   # write it into electron-builder.json
 *
 * test/meta/electronRuntimeDeps.test.js fails when the written list is stale.
 */
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILTIN = new Set(builtinModules);

/** Packages electron/**\/*.cjs requires that come from node_modules. */
export function mainProcessRequires(root = ROOT) {
  const found = new Set();
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(c?js|mjs)$/.test(entry.name)) {
        const text = fs.readFileSync(file, 'utf8');
        for (const m of text.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
          const spec = m[1] || m[2];
          if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
          const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
          if (name === 'electron' || BUILTIN.has(name)) continue;
          found.add(name);
        }
      }
    }
  };
  visit(path.join(root, 'electron'));
  return [...found].sort();
}

/** Every package `roots` reach through the installed node_modules, by name. */
export function runtimeClosure(roots, root = ROOT) {
  const names = new Set();
  const seen = new Set();
  const resolveFrom = (dir, name) => {
    for (let d = dir; ; d = path.dirname(d)) {
      const manifest = path.join(d, 'node_modules', name, 'package.json');
      if (fs.existsSync(manifest)) return path.dirname(manifest);
      if (d === root || d === path.dirname(d)) return null;
    }
  };
  const walk = (name, from) => {
    const at = resolveFrom(from, name);
    if (!at) throw new Error(`${name} is not installed (needed by the desktop app's main process)`);
    names.add(name);
    if (seen.has(at)) return;
    seen.add(at);
    const manifest = JSON.parse(fs.readFileSync(path.join(at, 'package.json'), 'utf8'));
    for (const dep of Object.keys(manifest.dependencies || {})) walk(dep, at);
    for (const dep of Object.keys(manifest.optionalDependencies || {})) {
      if (resolveFrom(at, dep)) walk(dep, at);
    }
  };
  for (const name of roots) walk(name, root);
  return [...names].sort();
}

/** The `files` patterns for `names`: everything in node_modules out, these back in. */
export const nodeModulesPatterns = (names) => ['!node_modules/**/*', ...names.map((n) => `node_modules/${n}/**/*`)];

/** electron-builder.json's `files` with its node_modules patterns replaced. */
export function withRuntimeDeps(config, names) {
  const own = (config.files || []).filter((p) => !/^!?node_modules\//.test(p));
  return { ...config, files: [...own, ...nodeModulesPatterns(names)] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const names = runtimeClosure(mainProcessRequires());
  if (process.argv.includes('--write')) {
    const file = path.join(ROOT, 'electron-builder.json');
    const text = fs.readFileSync(file, 'utf8');
    const { files } = withRuntimeDeps(JSON.parse(text), names);
    // Only the files array is rewritten, so the rest keeps its formatting.
    const block = `"files": [\n${files.map((f) => `    ${JSON.stringify(f)}`).join(',\n')}\n  ]`;
    fs.writeFileSync(file, text.replace(/"files": \[[^\]]*\]/, block));
    console.log(`[electron-runtime-deps] electron-builder.json packs ${names.length} packages: ${names.join(', ')}`);
  } else {
    console.log(names.join('\n'));
  }
}
