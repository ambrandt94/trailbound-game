# Trailbound

One game for the overworld map and the towns along it. This repository is the G0 shell: a title, a placeholder map, a short fade, and a placeholder 3D area, with saves and settings in place for the ports that follow.

## Play it on Windows

Install [Node.js 22](https://nodejs.org/), then in PowerShell or Command Prompt:

```bat
cd O:\Projects
git clone https://github.com/ambrandt94/trailbound-game.git trailbound-game
cd O:\Projects\trailbound-game
npm ci
npm run dev
```

Open the local URL Vite prints (usually `http://localhost:5173`). `--host` is on, so a phone on the same network can use the Network URL too.

To try a branch:

```bat
cd O:\Projects\trailbound-game
git fetch
git switch <branch>
npm ci
npm run dev
```

`npm ci` uses the committed lockfile. Do not use `npm install` for a clean setup.

## What you can do in this build

- **New** starts a seeded map. WASD or the arrow keys move the hero. Walk up to Waystead and press Enter.
- The screen fades to black (about 0.35s), the 3D view is built while it is black, then it fades in.
- In the town, WASD moves the pawn. Walk off the ground, or press Esc, to return. The hero lands just outside the town.
- **Save** on the map writes the hero position and the clock. Leave the town and the game saves on the way out too. **Continue** on the title restores that slot.
- **Settings** has volume sliders. Voices starts at 40. Mute voices is off. There is no audio yet; the values are stored.

## Scripts

| Script              | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | Vite dev server, listening on the LAN             |
| `npm run build`     | Production build in `dist/` (relative asset URLs) |
| `npm run preview`   | Serve `dist/`                                     |
| `npm run typecheck` | App project, then `src/core` with no DOM lib      |
| `npm run lint`      | ESLint, including the dependency rule             |
| `npm run format`    | Prettier write                                    |
| `npm test`          | Vitest (core in Node, render smoke in happy-dom)  |
| `npm run check`     | typecheck, lint, format check, test, asset guard  |

## Folders

| Path                            | Role                                                                        |
| ------------------------------- | --------------------------------------------------------------------------- |
| `src/core`                      | Engine-agnostic game data. No DOM, Three.js, Preact, or fetch.              |
| `src/platform`                  | Storage, content fetch, settings. The Electron file backend will live here. |
| `src/render/map`                | Canvas2D map. G0 is a placeholder grid; the map port replaces the drawing.  |
| `src/render/area`               | Three.js areas. G0 is a lit cube and a pawn.                                |
| `src/render/characters`         | The only future caller of Character Forge.                                  |
| `src/audio`                     | Voice and music, later.                                                     |
| `src/input`                     | Keyboard. `src/input/touch/` belongs to the touch-controls agent.           |
| `src/ui`                        | Preact title, settings, and the small HUD.                                  |
| `src/app`                       | The game loop, scene stack, and scene wiring.                               |
| `content`                       | JSON the game fetches. One town, Waystead, is checked in.                   |
| `public/vendor/character-forge` | Vendored Forge builds, written only by the sync script.                     |
| `public/assets`                 | Derived GLB / PNG / KTX2 only.                                              |
| `tools`                         | Asset guard and other cross-platform Node scripts.                          |
| `tests/fixtures`                | Golden saves and area exports, filled in by later milestones.               |
| `electron`                      | Desktop shell, milestone G5.                                                |

See `AGENTS.md` for the dependency rule and who owns which files.

Line endings are LF (`.gitattributes`).
