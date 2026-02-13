#!/usr/bin/env node
/**
 * Bundles secure-intake-client for the defense portal (strict CSP).
 *
 * @omnituum/pqc-shared is marked EXTERNAL — no WASM chunks are generated.
 * The defense portal uses attemptHybrid:false, so the dynamic import()
 * in hybrid-lazy.ts is dead code. If it ever runs, the import fails
 * with a module-not-found error caught by try/catch → X25519 fallback.
 *
 * This eliminates all WASM from the deploy: no chunk files, no
 * WebAssembly.instantiate(), no Emscripten abort risk.
 *
 * Run: node source/build-intake.mjs
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { rmSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const omni = resolve(root, '..', 'Omnituum');
const jsDir = resolve(root, 'public', 'assets', 'js');

// Clean stale chunks from previous builds
const chunksDir = resolve(jsDir, 'chunks');
rmSync(chunksDir, { recursive: true, force: true });

const result = await build({
  entryPoints: [resolve(__dirname, 'intake-entry.js')],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  platform: 'browser',
  outfile: resolve(jsDir, 'intake-client.js'),
  minify: true,
  nodePaths: [
    resolve(omni, 'secure-intake-client', 'node_modules'),
    resolve(omni, 'pqc-shared', 'node_modules'),
  ],
  // pqc-shared is EXTERNAL: no WASM in output, no chunk files.
  // The dynamic import("@omnituum/pqc-shared") in hybrid-lazy.ts
  // becomes dead code (attemptHybrid:false skips it entirely).
  external: ['crypto', '@omnituum/pqc-shared'],
  metafile: true,
});

// Print bundle size
const outBytes = Object.values(result.metafile.outputs)[0].bytes;
console.log(`  intake-client.js  ${(outBytes / 1024).toFixed(1)} KB`);

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
