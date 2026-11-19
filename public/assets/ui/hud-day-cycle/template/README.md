# Day-cycle HUD art template

One sheet with every sprite of the serpentine timer, so the art can be restyled in one go and sliced back into the game.

## Files

| File                               | What it is                                                                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hud-day-cycle-template-512.png`   | **The one to style.** 512x512, transparent, no labels. Every slot, state and frame sits in its own cell at **5x** (one art pixel is a 5x5 block), with transparent gutters between cells. |
| `hud-day-cycle-template-guide.png` | The same layout on a gray background with cell outlines (pink), slot names, 9-slice lines (cyan dashes) and anchor points (yellow +). Reference only, never edit or slice it.             |
| `hud-day-cycle-template-1x.png`    | The same layout at native size (102x102), for hand pixel editing in Aseprite or similar.                                                                                                  |
| `layout.json`                      | Where every cell is, in 512 pixels (`rect`) and native pixels (`rect1x`), plus native size, anchor, 9-slice insets and state names.                                                       |

The pixel font is three rows of glyph strips at the bottom of the sheet. The guide marks each glyph cell and names it.

## How to edit

1. Edit the 512 sheet (or the 1x one). Keep every cell where it is and the background transparent.
2. Keep each sprite inside its cell. The cell is the native size of the slot: a 5x5 bead is a 25x25 block on the 512 sheet.
3. Keep the art on the 5x5 pixel grid. Slightly off-grid output is fine: when slicing, every 5x5 block becomes its most common colour, and blocks that are mostly clear become transparent.
4. Draw tintable slots (`node_gem_lit`, `sub_node` lit, `terrain_mask`) with gray where the colour should change and pure white for the specular pixel. See `../README.md`.
5. Slice it back:

   ```
   node tools/hud-day-cycle-slice.mjs path/to/edited-sheet.png
   ```

   Or just send the edited PNG back and it will be sliced for you.

The slicer takes the 512 sheet, the 1x sheet, or a 512 export at a whole multiple (1024, ...), and picks the mode from the size. It writes the PNGs into `public/assets/ui/hud-day-cycle/`, in the same names and sizes as `manifest.json`. Options: `--out <dir>` to write elsewhere, `--dry-run` to only check, `--alpha-min <0-255>` to change how faint a pixel can be before it counts as clear (default 16).

Changing a sprite's size or adding a slot means editing `manifest.json` first, then rebuilding the template with `node tools/hud-day-cycle-template.mjs`. That also refreshes the template from whatever art is in the game now. Rebuilding replaces `layout.json`, so slice any sheet you already edited before you rebuild.
