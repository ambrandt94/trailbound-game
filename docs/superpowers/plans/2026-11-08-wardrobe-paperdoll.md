# Wardrobe paperdoll implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live paperdoll that equips the saved Forge recipe and rebuilds the real preview.

**Architecture:** The creator scene owns the recipe. A wardrobe panel lists `optionsFor().slots` in key order and sends outfit and dye patches through the existing edit API. Camera focus reads the mesh bounds. Slot-region filtering is not implemented.

**Tech Stack:** Preact, the vendored Character Forge 1.2.0 runtime, Vitest, the merged pixel skin.

## Global Constraints

- Branch from current `main`. Do not edit the map.
- Do not write `public/vendor/character-forge` or add a save field.
- Do not hardcode a slot order or an upper/lower slot list.
- Do not label coverage as hidden.
- Confirm and cancel keep today's save behavior.
- Touch targets are at least 44px. Long lists scroll.

---

### Task 1: Patch choice

- [x] Test `chooseStatePatch` and `diffOutfit` with fake accepts.
- [x] Implement them in `src/app/wardrobe-edit.ts`.

### Task 2: Engine cases

- [x] Assert adult options expose 29 slots including `baldric`, in key order.
- [x] Assert tunic, riding boots, bandana, hood, and unequip patches by calling the edit API.

### Task 3: Screen

- [x] Pass garment states through `optionsFor`.
- [x] Add the wardrobe panel, camera frames, and creator entry points.
- [x] Style it with the existing skin. Screenshot desktop, narrow, and more than one body.

### Task 4: Pin

- [x] Resolve the runtime path and `CF_PIN` from `current.json`.
- [x] Keep the 1.2.0 vendor directory. Reject a pin that is not a version triple.

Slot-region filtering stays open until the 1.2.1 package is in the tree.
