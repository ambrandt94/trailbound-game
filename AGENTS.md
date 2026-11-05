# AGENTS.md

Trailbound is one web game: the overworld map, 3D areas, and later encounters and minigames. G0 is the shell. After every merge, `main` must still run with `npm ci` and `npm run dev`.

## Dependency rule

`src/core` imports nothing outside `src/core`. No DOM, no Three.js, no Preact, no `fetch`, no IndexedDB. Core gets time from an injected clock and does I/O only through `SaveBackend` and `ContentSource`.

`platform`, `render`, `audio`, `input`, and `ui` may import `core` and their own folder, plus packages. They do not import each other.

Only `src/app` wires those layers together.

This is enforced twice:

1. `src/core/tsconfig.json` sets `lib` to `ES2022` and includes no DOM types, so `window`, `document`, or `indexedDB` in core fails `npm run typecheck`.
2. ESLint `boundaries/dependencies` in `eslint.config.js` fails CI when an import crosses a layer, including a `three` import from core.

`tests/core/dependency-rule.test.ts` is the deliberate check. It fails if either enforcement stops catching a bad import. Do not weaken the test or the rule to get a green build.

## File owners

- `src/input/touch/` — **touch-controls agent** (Alex's separate agent; the same one that owns the controller touch pad). Other agents only wire `attachTouchControls` from `src/app`. Do not change the pad implementation.
- `public/vendor/character-forge/` — written only by `tools/sync-character-bundle.mjs` when that script lands with the Character Forge port. Never hand-edit vendored files.
- Other agents may edit the rest of the repo, inside the dependency rule.

## Assets

Commit only derived runtime assets (GLB, PNG, KTX2, JSON, OGG). Never commit `.unitypackage`, `.fbx`, `.blend`, `.psd`, or any file over 10 MB. `npm run assets:guard` fails the check when one shows up. Source art stays in local folders, not in git.

## Branches and pull requests

- Branch names look like `cursor/g<N>-<slug>`.
- One slice per PR. The author does not merge; Alex reviews and merges.
- Every PR description has a **How to see it** block: the exact commands, the URL, what to click or press, and screenshots.
- `npm run check` and `npm run build` pass before the PR is ready.
- Do not leave `main` unable to boot.

## Saves, hosting, Electron

No server APIs. Vite `base` is `./`, so built asset URLs stay relative. No CDN scripts; Three.js comes from npm. Do not put game saves in `localStorage` or cookies. The settings mix may use `platform/settings`. IndexedDB is the web save backend (`tb-save-<slot>`).

Cloudflare deploy starts at G1, not in this shell. Electron and the filesystem backend are G5.

## Stack

Node 22, Vite, TypeScript (`strict`, `noUncheckedIndexedAccess`), `three` pinned to an exact version, Preact and `@preact/signals`, Vitest. Scripts are cross-platform Node, not shell.
