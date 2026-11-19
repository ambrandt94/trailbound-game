# Day-cycle HUD art template

One sheet with every sprite of the serpentine timer, so the art can be restyled in one go and sliced back into the game.

## Files

| File                               | What it is                                                                                                                                                                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hud-day-cycle-template-512.png`   | **The one to style.** 512x512, transparent, no labels. A **sample band** at the top, then every slot, state and frame in its own cell at **3x** (one art pixel is a 3x3 block), with transparent gutters between cells. The font is one cell per glyph.     |
| `hud-day-cycle-template-guide.png` | The same layout on a gray background with cell outlines (pink), slot names, 9-slice lines (cyan dashes), anchor points (yellow +), the character under each font cell, and the sample band framed in orange dashes. Reference only, never edit or slice it. |
| `hud-day-cycle-template-1x.png`    | The same layout at native size (170x170), for hand pixel editing in Aseprite or similar.                                                                                                                                                                    |
| `layout.json`                      | Where every cell is, in 512 pixels (`rect`) and native pixels (`rect1x`), plus the sample band, native size, anchors, 9-slice insets, state names and the font grid.                                                                                        |

## The sample band (top of every sheet)

The strip along the top is the HUD put together from the current sprites: the sky strip with the sun, a stretch of the serpentine chain with lit and drained beads, the noon and sunrise medallions, the pill with its text (84 TU left, 8:50A), the dawn end-cap and its "100" label. It is the right-hand end of the real HUD (the whole HUD is 361 px wide, wider than the sheet), at the same 3x scale as the cells.

It is **reference only**. It is drawn by the game's own renderer (`src/ui/day-cycle/render.ts`) from the PNGs in the game right now, so it always matches what you would see in the game. Edits to it are ignored by the slicer. To see your art assembled, slice it in and look at the game, or rebuild the template.

## The pixel font

Every glyph (digits, A to Z, `- . / :`) has its own cell, so each one is easy to edit alone. Cells sit on a fixed pitch of 7 native pixels (3 px for the glyph, 4 clear pixels between neighbours) in two rows. The guide names each cell with the character beneath it.

- A glyph is 3x5. `:` and `.` are only 1 px wide in the game, so their cells are 1x5.
- Space has no cell: it is a blank 2 px advance.
- The game draws text with 1 px of tracking between glyphs on top of the glyph width, so do not add side padding inside a cell.
- The slicer puts the glyphs back into `pixel_font.png` in the game's layout (one 3 px slot per glyph, in `font.glyphs` order).

## How to edit

1. Edit the 512 sheet (or the 1x one). Keep every cell where it is and the background transparent.
2. Keep each sprite inside its cell. The cell is the native size of the slot: a 5x5 bead is a 15x15 block on the 512 sheet.
3. Draw on the 3x grid. Slightly off-grid output is fine: when slicing, every 3x3 block becomes its most common colour, and blocks that are mostly clear become transparent. If you upres first, keep each cell where it is, scaled by the same factor.
4. Draw tintable slots (`node_gem_lit`, `sub_node` lit, `terrain_mask`) with gray where the colour should change and pure white for the specular pixel. See `../README.md`.
5. Slice it back:

   ```
   node tools/hud-day-cycle-slice.mjs path/to/edited-sheet.png
   ```

   Or just send the edited PNG back and it will be sliced for you.

The slicer takes the 512 sheet, the 1x sheet, or a 512 export at a whole multiple (1024, ...), and picks the mode from the size. It writes the PNGs into `public/assets/ui/hud-day-cycle/`, in the same names and sizes as `manifest.json`. Options: `--out <dir>` to write elsewhere, `--dry-run` to only check, `--alpha-min <0-255>` to change how faint a pixel can be before it counts as clear (default 16), `--layout <layout.json>` to use another layout. Anything outside the listed cells (the sample band, gutters) is ignored.

Slicing the untouched 512 and 1x sheets gives back every placeholder PNG exactly, including the pixel font.

## Why 3x

512 is not a whole multiple of 3, so the cells use the top-left 510x510 and the last 2 px stay clear. Every cell starts on a multiple of 3. 5x and 4x do not fit: with the sample band (62 native rows) plus labelled cells plus the spaced-out font, 4x needs about 154 rows and has 126. 3x gives 170 native pixels across (the sample band is 170 wide) and 159 rows used of 167. The 1x sheet matches it pixel for pixel.

## Rebuilding and older sheets

Changing a sprite's size or adding a slot means editing `manifest.json` first, then rebuilding the template with `node tools/hud-day-cycle-template.mjs`. That also refreshes the template and the sample band from whatever art is in the game now. Rebuilding replaces `layout.json`, so slice any sheet you already edited before you rebuild.

A sheet edited from the first template (5x, font in strips) still slices: use the `layout.json` that came with it, with `--layout path/to/old/layout.json`.
