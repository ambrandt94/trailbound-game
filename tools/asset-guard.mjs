import { readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const DENIED = new Set(['.unitypackage', '.fbx', '.blend', '.psd']);
const SKIP = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  '.vite',
]);
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * @param {string} root
 * @param {{ maxBytes?: number }} [options]
 * @returns {string[]}
 */
export function findViolations(root, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  /** @type {string[]} */
  const violations = [];
  walk(root, root, maxBytes, violations);
  return violations;
}

/**
 * @param {string} dir
 * @param {string} root
 * @param {number} maxBytes
 * @param {string[]} violations
 */
function walk(dir, root, maxBytes, violations) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, root, maxBytes, violations);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = extname(entry.name).toLowerCase();
    const size = statSync(full).size;
    const display = relative(root, full) || entry.name;
    if (DENIED.has(extension)) {
      violations.push(`${display} has denied extension ${extension}`);
    }
    if (size > maxBytes) {
      violations.push(`${display} is ${size} bytes (limit ${maxBytes})`);
    }
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  const violations = findViolations(process.cwd());
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exit(1);
  }
}
