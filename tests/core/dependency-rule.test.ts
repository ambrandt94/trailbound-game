import { ESLint } from 'eslint';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));

async function lintFile(code: string, filePath: string) {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });
  return result;
}

function messages(result: Awaited<ReturnType<typeof lintFile>>): string {
  return result?.messages.map((message) => message.message).join('\n') ?? '';
}

test('eslint rejects core importing platform, three, and platform importing render', async () => {
  const coreToPlatform = await lintFile(
    "import { createMemorySaveBackend } from '../../platform/storage/memory';\nexport const leak = createMemorySaveBackend;\n",
    resolve(root, 'src/core/state/boundary-probe.ts'),
  );
  expect(coreToPlatform?.errorCount ?? 0, messages(coreToPlatform)).toBeGreaterThan(0);
  expect(messages(coreToPlatform)).toMatch(/boundaries|platform|not allowed|no rule|no policy/i);

  const coreToThree = await lintFile(
    "import * as THREE from 'three';\nexport const geo = THREE.BoxGeometry;\n",
    resolve(root, 'src/core/render-probe.ts'),
  );
  expect(coreToThree?.errorCount ?? 0, messages(coreToThree)).toBeGreaterThan(0);

  const platformToRender = await lintFile(
    "import { MapRenderer } from '../render/map/map-renderer';\nexport const leak = MapRenderer;\n",
    resolve(root, 'src/platform/boundary-probe.ts'),
  );
  expect(platformToRender?.errorCount ?? 0, messages(platformToRender)).toBeGreaterThan(0);
});

test('eslint allows core-to-core and app wiring', async () => {
  const coreToCore = await lintFile(
    "import { WorldState } from './world-state';\nexport const marker = WorldState;\n",
    resolve(root, 'src/core/state/boundary-ok.ts'),
  );
  expect(coreToCore?.errorCount ?? 0, messages(coreToCore)).toBe(0);

  const appWires = await lintFile(
    "import { WorldState } from '../core/state/world-state';\nimport { createMemorySaveBackend } from '../platform/storage/memory';\nexport const ok = { WorldState, createMemorySaveBackend };\n",
    resolve(root, 'src/app/boundary-ok.ts'),
  );
  expect(appWires?.errorCount ?? 0, messages(appWires)).toBe(0);
});

test('core tsconfig has no DOM lib and rejects document', () => {
  const configPath = resolve(root, 'src/core/tsconfig.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(read.error).toBeUndefined();
  const rawLib = (read.config as { compilerOptions?: { lib?: string[] } }).compilerOptions?.lib;
  expect(rawLib).toEqual(['ES2022']);

  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, resolve(root, 'src/core'));
  const libs = (parsed.options.lib ?? []).map((lib) => lib.toLowerCase());
  expect(libs.some((lib) => lib.includes('dom'))).toBe(false);

  const fileName = resolve(root, 'src/core/dom-probe.ts');
  const options: ts.CompilerOptions = { ...parsed.options, noEmit: true };
  const host = ts.createCompilerHost(options);
  const source = ts.createSourceFile(
    fileName,
    'export const el = document.body;\n',
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const original = host.getSourceFile.bind(host);
  host.fileExists = (file) => file === fileName || ts.sys.fileExists(file);
  host.getSourceFile = (file, languageVersion, onError, shouldCreate) => {
    if (file === fileName) return source;
    return original(file, languageVersion, onError, shouldCreate);
  };
  const program = ts.createProgram({
    rootNames: [...parsed.fileNames, fileName],
    options,
    host,
  });
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((diag) => diag.file?.fileName === fileName);
  const text = diagnostics
    .map((diag) => ts.flattenDiagnosticMessageText(diag.messageText, '\n'))
    .join('\n');
  expect(text).toMatch(/document/);
});
