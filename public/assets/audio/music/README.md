# Soundtrack (derived from the Asset Matrix)

`*.ogg` and `manifest.json` here are **generated** by `tools/music-sync.mjs` from a Trailbound music bundle exported from the Asset Matrix music dataset. Do not hand-edit them. The game never fetches the Matrix at runtime (it sits behind a Cloudflare Access login); it loads `manifest.json` and streams the OGGs from this folder.

## Re-sync from a new Matrix export

1. Get the new bundle folder: it holds `music.json` and `audio/<id>.ogg` (same layout as `trailbound-music-bundle/`).
2. From the repo root:

   ```
   node tools/music-sync.mjs <path-to-bundle-folder>
   ```

   The tool validates every track (id matches its key, `audio/<id>.ogg` exists and is an Ogg file under 10 MB, `context` tags are in the export's vocabulary, intensity 0..1, duration > 0), copies the OGGs here, removes OGGs the export no longer has, and rewrites `manifest.json`. It lists every problem at once and writes nothing if the bundle is invalid.

3. Commit the changed OGGs and `manifest.json`.

## What the tags do

Each track's `context` tags (`title`, `map`, `travel-day`, `travel-night`, `camp`, `town`, `forest`, `desert`, `beach`, `grove`, `minigame`) and `intensity` feed the music director. Which context asks for which tags, and how much each is worth, is one table: `src/core/music/rules.ts`. Retune the soundtrack there, or re-tag a track in the Matrix and re-sync.

The tags in the first export were inferred from track names and loudness, not authored. Review them.

## Debugging

In the browser console, `__tbMusic.get()` shows the playing track, the context, the scored candidates, and the live crossfade gains. `__tbMusic.force({ scene: 'area', biome: 4 })` pins a context; `__tbMusic.force(null)` hands control back; `__tbMusic.settle()` skips the holds.
