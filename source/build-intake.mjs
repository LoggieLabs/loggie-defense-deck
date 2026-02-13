#!/usr/bin/env node
/**
 * Bundles secure-intake-client + pqc-shared into a single browser-ready ESM file.
 * Run: node source/build-intake.mjs
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const omni = resolve(root, '..', 'Omnituum');

const result = await build({
  entryPoints: [resolve(__dirname, 'intake-entry.js')],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  platform: 'browser',
  outfile: resolve(root, 'public', 'assets', 'js', 'intake-client.js'),
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

// Print bundle size
const outBytes = Object.values(result.metafile.outputs)[0].bytes;
console.log(`✓ intake-client.js  ${(outBytes / 1024).toFixed(1)} KB`);
