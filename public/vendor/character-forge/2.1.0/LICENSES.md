# LICENSES: Character Forge runtime 2.1.0

Every shipped file is listed by rule below (machine-readable: `licenses.json`). `tools/licenses.mjs check` fails the build if a file has no rule or if any Kevin Iglesias (KI) clip is present.

## Flagged: licence UNCLEAR

- none (Meshy bases cleared: paid plan, confirmed by Alex 2026-11-20)

## Cleared

- `^assets\/models\/.*\.glb$`: **Meshy paid plan (commercial use) + CF-authored edits**. Body meshes: bases generated with Meshy AI on Alex's paid Meshy plan (confirmed by Alex 2026-11-20, t282u), then remeshed, symmetrised, re-UVed, rigged and skinned by Character Forge (Blender scripts). Embedded Idle / Walk actions are CF-authored (bpy actions in races2..9 build_race*.py). Paid-plan Meshy output: commercial use and inclusion in the game (public repo) cleared by the owner.
- `^assets\/ears\/.*\.glb$`: **Meshy paid plan (commercial use) + CF-authored**. Ear variants, Character Forge ear pipeline (symmetry/ears, ear_add.py); the default elf_long ear comes from the Meshy-derived rig (paid plan, t282u).
- `^assets\/parts\/.*\.glb$`: **CF-authored**. Snouts / horns / wings / noses built procedurally by Character Forge Blender scripts (races2..9 build_race*.py, noses1/2). Generated geometry; palette textures CF-made.
- `^assets\/clips\/.*\.json$`: **CF-authored**. Walk exported from tiefling2260 (races3 build_race3.py procedural action).
- `^assets\/packs\/quaternius_anims\.glb$`: **CC0-1.0**. Quaternius, Universal Animation Library 1 (Standard), https://quaternius.com/packs/universalanimationlibrary.html Optional (policy animationSet "cf+cc0"); retargeted to the CF rig.
- `^assets\/packs\/kaykit_anims\.glb$`: **CC0-1.0**. Kay Lousberg, KayKit Character Animations 1.1, https://kaylousberg.com/game-assets/character-animations Optional; retargeted to the CF rig. Not wired by default.
- `^assets\/shared\/(hair|face|racepal|meta)\.json$`: **CF-authored**. Hair index texture + ramps (hair4), face sheet pixel art (face presets, brows1), race palette role maps, labels. Role maps are painted on the UV layout of the Meshy-derived body; the pixels are CF-made.
- `^assets\/wardrobe\/.*\.png$`: **CF-authored**. Painted wardrobe index maps (wardrobe1 pipeline).
- `^(cf-runtime\.mjs|chunks\/.*\.mjs)$`: **CF code + MIT (three.js addons GLTFLoader, SkeletonUtils bundled in the engine chunk)**. Character Forge runtime; three.js examples/jsm addons (c) three.js authors, MIT. three itself is a peer dependency, not bundled.

## Excluded

- Kevin Iglesias animation clips: licensed to Alex (purchased; Unity Asset Store licence lets them be used in the game but not redistributed as raw files). They are NEVER in this public folder or assets.json. They ship separately as a private pack (`ki_manifest.json` + clip files) that the game serves from a private location and registers at runtime: `CF.init({ privateAnimBaseUrl })` or `CF.registerAnimSet('ki', urlOrLoader)`, then `policy.animationSet: 'cf+ki'` or `'cf+cc0+ki'`. Keep the private pack out of the public game repo (gitignore it / fetch it from private storage at build or run time).
- three.js: peer dependency (MIT), not bundled.

## MIT notice (three.js addons bundled in chunks/engine_entry-*.mjs)

The MIT License. Copyright © 2010-2026 three.js authors. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

## File list

### Meshy paid plan (commercial use) + CF-authored edits (14)

- assets/models/bald2040.glb
- assets/models/mouse2248.glb
- assets/models/tiefling2260.glb
- assets/models/halfling2052.glb
- assets/models/gnome2088.glb
- assets/models/dwarf2100.glb
- assets/models/goliath2174.glb
- assets/models/firbolg2162.glb
- assets/models/orc2258.glb
- assets/models/goblin2130.glb
- assets/models/kobold2406.glb
- assets/models/imp2440.glb
- assets/models/pixie2254.glb
- assets/models/dragon2390.glb

### Meshy paid plan (commercial use) + CF-authored (28)

- assets/ears/elf_long.glb
- assets/ears/elf_short.glb
- assets/ears/pointed_small.glb
- assets/ears/human_round.glb
- assets/ears/mouse_round.glb
- assets/ears/dragon_frill.glb
- assets/ears/tf_pointed_small.glb
- assets/ears/tf_elf_short.glb
- assets/ears/hf_round.glb
- assets/ears/hf_leaf.glb
- assets/ears/gn_swept.glb
- assets/ears/gn_tall.glb
- assets/ears/dw_round.glb
- assets/ears/ip_pointed.glb
- assets/ears/ip_long.glb
- assets/ears/px_long.glb
- assets/ears/px_swept.glb
- assets/ears/kb_frill.glb
- assets/ears/kb_fin.glb
- assets/ears/or_pointed.glb
- assets/ears/or_round.glb
- assets/ears/gb_swept.glb
- assets/ears/gb_wide.glb
- assets/ears/gl_round.glb
- assets/ears/gl_pointed.glb
- assets/ears/fb_droop.glb
- assets/ears/fb_long.glb
- assets/ears/dw_lobe.glb

### CF-authored (53)

- assets/parts/snout_mouse.glb
- assets/parts/snout_dragon_long.glb
- assets/parts/snout_dragon_blunt.glb
- assets/parts/horns_dragon_swept.glb
- assets/parts/horns_dragon_short.glb
- assets/parts/horns_tf_upswept.glb
- assets/parts/horns_tf_swept.glb
- assets/parts/horns_tf_ram.glb
- assets/parts/horns_tf_short.glb
- assets/parts/nose_gn_button.glb
- assets/parts/nose_gn_bulb.glb
- assets/parts/nose_gn_pointed.glb
- assets/parts/nose_dw_broad.glb
- assets/parts/nose_dw_round.glb
- assets/parts/horns_ip_swept.glb
- assets/parts/horns_ip_curl.glb
- assets/parts/wings_ip_bat.glb
- assets/parts/wings_px_butterfly.glb
- assets/parts/wings_px_dragonfly.glb
- assets/parts/snout_kb_round.glb
- assets/parts/snout_kb_pointed.glb
- assets/parts/horns_kb_swept.glb
- assets/parts/horns_kb_nubs.glb
- assets/parts/nose_or_tusks.glb
- assets/parts/nose_or_big.glb
- assets/parts/nose_gb_hook.glb
- assets/parts/nose_gb_long.glb
- assets/parts/nose_gl_broad.glb
- assets/parts/nose_gl_flat.glb
- assets/parts/nose_fb_bovine.glb
- assets/parts/nose_fb_soft.glb
- assets/parts/nose_dw_hawk.glb
- assets/parts/nose_gl_big.glb
- assets/parts/nose_dw_big.glb
- assets/parts/nose_or_large.glb
- assets/shared/hair.json
- assets/shared/face.json
- assets/shared/racepal.json
- assets/shared/meta.json
- assets/wardrobe/belt_leather.png
- assets/wardrobe/broadfall_patched.png
- assets/wardrobe/broadfall_plain.png
- assets/wardrobe/broadfall_striped.png
- assets/wardrobe/paint_baldric.png
- assets/wardrobe/shirt_calico.png
- assets/wardrobe/shirt_homespun.png
- assets/wardrobe/smallclothes_drawers.png
- assets/wardrobe/smallclothes_linen.png
- assets/wardrobe/socks_darned.png
- assets/wardrobe/socks_plain.png
- assets/wardrobe/vest_closed.png
- assets/wardrobe/vest_open.png
- assets/clips/humanoid_walk.json

### CC0-1.0 (2)

- assets/packs/quaternius_anims.glb
- assets/packs/kaykit_anims.glb
