# Wardrobe paperdoll

The wardrobe edits the live Character Forge 1.2.0 recipe already stored on the player. It does not add a save field, an inventory, or a preset. Slot order is the key order of `optionsFor().slots` (the same order as `describeRecipe().outfit`). `forgeCatalog().slots` is not used.

Upper and lower slot filters wait for Forge `catalog.slotRegions`. The agreed partition uses `legs` as the sentinel: 24 upper slots before it and 5 lower slots from it, in canonical order. Occupation will be a Forge-generated when-state to slots list on the edit catalog, not copied onto options. Full, upper, and lower only move the existing preview camera, using the built body's bounds. Focus does not call `edit`.

Equip, unequip, dye, and states go through `checkRecipeEdit` then `editRecipe`. A state change tries each slot that offers the garment, current homes first, and keeps the first patch the engine accepts. Displacement is the difference between the two `describe` outfits. The screen never says a piece is hidden.

The paperdoll shares the creator scene: same recipe, 12-snap undo, numbered rebuild, confirm, and cancel. Edit avatar opens it directly. A new traveller reaches it from the creator, and body and face controls stay one step back.

The runtime path and the save pin both come from `public/vendor/character-forge/current.json`. Syncing a later package updates that file and adds a version directory. The 1.2.0 directory stays. `generatorVersion` stays 1 until Forge says otherwise.
