# Wardrobe paperdoll

The wardrobe edits the live Character Forge recipe already stored on the player. It does not add a save field, an inventory, or a preset. Slot order is the key order of `optionsFor().slots` (the same order as `describeRecipe().outfit` and `editCatalog().slots`). `forgeCatalog().slots` is not used.

All lists that canonical order. Upper and lower list `catalog.slotRegions` from the live edit catalog, in that same order, and frame the body to match. The counts are whatever Forge published. Focus does not call `edit`. A garment stays in the region of its edit slot even when the mesh covers another part of the body.

Equip, unequip, and dye go through `checkRecipeEdit` then `editRecipe`. A state change keys the patch with the first slot of the one matching `garments[id].occupation` row, then `checkEdit` accepts or refuses it. Displacement is the difference between the two `describe` outfits. The screen never says a piece is hidden.

The paperdoll shares the creator scene: same recipe, 12-snap undo, numbered rebuild, confirm, and cancel. Edit avatar opens it directly. A new traveller reaches it from the creator, and body and face controls stay one step back.

The runtime path and the save pin both come from `public/vendor/character-forge/current.json`. Syncing a later package updates that file and adds a version directory. The 1.2.0 directory stays. `generatorVersion` stays 1 until Forge says otherwise.
