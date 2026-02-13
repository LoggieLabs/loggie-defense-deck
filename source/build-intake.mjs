#!/usr/bin/env node
/**
 * Bundles secure-intake-client into browser-ready ESM with code splitting.
 *
 * The main entry chunk contains only pure-JS code (no WASM).
 * @omnituum/pqc-shared (Kyber WASM) is split into a lazy chunk that is
 * only fetched when hybrid encryption is actually attempted via dynamic
 * import() inside hybrid-lazy.ts.
 *
 * Run: node source/build-intake.mjs
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const omni = resolve(root, '..', 'Omnituum');
const jsDir = resolve(root, 'public', 'assets', 'js');

const result = await build({
  entryPoints: [resolve(__dirname, 'intake-entry.js')],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  platform: 'browser',
  // Code splitting: outdir instead of outfile
  outdir: jsDir,
  splitting: true,
  entryNames: 'intake-client',       // main entry → intake-client.js
  chunkNames: 'chunks/[name]-[hash]', // lazy chunks → chunks/
  minify: true,
  nodePaths: [
    resolve(omni, 'secure-intake-client', 'node_modules'),
    resolve(omni, 'pqc-shared', 'node_modules'),
  ],
  // Node built-in 'crypto' is only used as fallback when globalThis.crypto is missing.
  // Browsers always have Web Crypto API, so mark it external (dead code in browser).
  external: ['crypto'],
  metafile: true,
});

// Print sizes for all output chunks
const outputs = result.metafile.outputs;
for (const [file, meta] of Object.entries(outputs)) {
  const name = file.split('/').slice(-2).join('/');
  const kb = (meta.bytes / 1024).toFixed(1);
  console.log(`  ${name.padEnd(40)} ${kb} KB`);
}

// ── Build assertion: no WASM/pqc-shared in entry chunk ──────────────────
import { readFileSync } from 'fs';

const entryPath = resolve(jsDir, 'intake-client.js');
const entryCode = readFileSync(entryPath, 'utf8');

// Patterns that must never appear in the entry chunk.
// String literals in error messages are OK (e.g. "pqc-shared module failed to load").
// We check for actual code-level references, not human-readable diagnostics.
const FORBIDDEN = [
  { pattern: /WebAssembly\s*\./, reason: 'WASM API call would abort under strict CSP' },
  { pattern: /from\s*["']@omnituum\/pqc-shared/, reason: 'static import triggers WASM at module eval time' },
  { pattern: /require\s*\(\s*["']@omnituum\/pqc-shared/, reason: 'require() triggers WASM at module eval time' },
];

const violations = [];
for (const { pattern, reason } of FORBIDDEN) {
  if (pattern.test(entryCode)) {
    violations.push(`  ✘ Matched ${pattern} in entry chunk — ${reason}`);
  }
}

if (violations.length > 0) {
  console.error('\n🚫 ENTRY CHUNK CONTAMINATION — build failed:\n');
  violations.forEach(v => console.error(v));
  console.error('\nThe entry chunk must contain only pure-JS code.');
  console.error('pqc-shared must stay in lazy chunks loaded via dynamic import().\n');
  process.exit(1);
}

console.log('\n✓ Entry chunk clean: no WebAssembly, no pqc-shared');
