/**
 * Check a vendored Character Forge tree against a sha256 manifest.
 * `assets.json` lists the lazy asset files. `bundle.json` lists the runtime files.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {string} versionRoot
 * @param {string} manifestName
 * @returns {string[]}
 */
export function verifyShaManifest(versionRoot, manifestName) {
  const manifestPath = join(versionRoot, manifestName);
  if (!existsSync(manifestPath)) return [`${manifestName} is missing`];
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const files = manifest?.files;
  if (!files || typeof files !== 'object') return [`${manifestName} has no files table`];
  /** @type {string[]} */
  const problems = [];
  for (const [rel, meta] of Object.entries(files)) {
    const expected = meta && typeof meta === 'object' ? meta : {};
    const file = join(versionRoot, rel);
    if (!existsSync(file)) {
      problems.push(`${rel} is missing`);
      continue;
    }
    const data = readFileSync(file);
    const sha = createHash('sha256').update(data).digest('hex');
    if (sha !== expected.sha256) problems.push(`${rel} sha256 ${sha} != ${expected.sha256}`);
    if (data.length !== expected.bytes) {
      problems.push(`${rel} is ${data.length} bytes, manifest says ${expected.bytes}`);
    }
  }
  return problems;
}
