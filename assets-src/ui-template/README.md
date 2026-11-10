# UI template sheet

Paint over `ui_template_sheet.png`, then slice it back into the game.

The sheet is the source. Each sprite sits in the rectangle stored in `ui_template_manifest.json`. The art cell itself is clean. `ui_template_sheet_guide.png` is a transparent overlay with the element name, state, pixel size, and 9-slice lines (magenta). `ui_template_sheet_blank.png` is the same guide on parchment with no artwork, for starting a sheet from scratch.

## Replace the skin

1. Edit `ui_template_sheet.png`. Keep every sprite inside its manifest rect. Do not change the canvas size unless you also edit the rects in `ui_template_manifest.json`.
2. From the repo root, run `npm run ui:import`.
3. That writes `src/ui/theme/sprites/*.png`, `src/ui/theme/ui_atlas.png`, and `src/ui/theme/ui_atlas_9slice.json`. The game loads those files.

`npm run ui:sheet` redraws this sheet from the procedural generator and **replaces any painting**. Use it only to rebuild the starter sheet.

## 9-slice

`borders` is left, top, right, bottom in source pixels. The game draws the sprites 1:1 (`display_scale` 1). `--tb-ui-scale` in the menu CSS is 1, 2, or 3 and enlarges the same slices by whole pixels. A border of 0 means the sprite is a fixed icon and is not sliced.

## Type

Softball Gold is a 16px pixel font. Menus use 32px for body, buttons, rows, and headers, and 48px for the screen title. Both are whole multiples of 16. The face metrics are shifted with `ascent-override` / `descent-override` so capitals sit in the middle of the line.
