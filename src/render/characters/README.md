# Player avatar hook

`forge.ts` is the game-facing character API. `backends/v2.ts` imports the Character Forge 2.6.0 runtime. There is no v1 runtime. With no `?cf=` param the game loads 2.6.0. `?cf=2` (also `v2` / `cf2`) does the same, and so do the retired `?cf=1` values. `?cf=0` skips the runtime. If init or preload fails, the player gets the placeholder pawn.

Public builds keep the animation policy at `cf`. 2.6.0's default locomotion is `full`, so Idle, Walk, and Run are the CC0 Quaternius clips shipped in the runtime, retargeted to the v2 skeleton. `policy.flyerIdle` stays the runtime default `hover`. A winged race (pixie, imp) stands in `Hover`. Walk and Run stay on the ground. The dojo is a ground fight, so it presents `Idle` even for a winged body. The creator's idle toggle plays `Hover` for a winged race and `Idle` for everyone else. The map uses the same rule through `forgePresentation`. A private build can set `VITE_CF_PRIVATE_ANIM_URL` to a Kevin Iglesias pack served outside this repo. That pack must be the v2-rig copy (Character Forge store `runtime_v2/private_ki/`, or `private_ki_mega/` for the larger set). The old-rig packs are deprecated. That env var is the only switch to `cf+ki`. Do not commit the pack or point a public build at it.

The area controller (the port into `src/render/area`) should not import Character Forge. After the player confirms a look, the committed body is available here:

```ts
import { getPlayerBody, tickPlayerBody } from '../characters';

// once, when a body appears
const body = getPlayerBody();
if (body && body.object3D.parent !== scene) {
  scene.add(body.object3D);
  placeholderPawn.visible = false;
}

// every frame, in place of spinning the capsule
const body = getPlayerBody();
if (body) {
  body.object3D.position.set(pose.x, 0, pose.z);
  body.object3D.rotation.y = pose.yaw;
  body.present({ clip: moving ? 'Walk' : 'Idle', timeScale, fade: 0.16 });
  tickPlayerBody(dt);
} else {
  placeholderPawn.visible = true;
}
```

`getPlayerBody()` is null until a look is confirmed or a continue warms the saved recipe. After `?cf=0` or a Forge failure it is still a body: `source === 'placeholder'` (a lit capsule pawn, not a block). Do not dispose the body from the area; the creator replaces it on the next confirm. The saved `player.avatar.recipe` is the opaque Forge recipe, so a rebuild of that object matches the creator. Schema 5 records `player.avatar.engine`. A look confirmed under the runtime is `cf2`. A schema 4 save copies that recipe into `legacyRecipe`, tags `engine: 'cf1'`, and still builds. Loading a `cf1` avatar migrates a copy in memory and does not rewrite the save. Confirming that look stores `engine: 'cf2'` and keeps the old recipe on `legacyRecipe`. Saves whose `cfPin` is 1.x or 2.2.1 are re-pinned to 2.6.0 on load. Every body, in town and on the road, uses one uniform scale: 1.4 divided by the human height. Races keep their lineup, and the scale is not Y-only.

Pixies and imps hover while standing. `forgePresentation` asks for `Hover` at rest and `Walk` once they move. Ground Run is left off for flyers. Other races use `Idle` at rest and `Run` once they are moving faster than a walk. `play` is the hard cut the creator uses.

Set the area renderer to `outputColorSpace = SRGBColorSpace` (the shell already does). Forge atlases are sRGB and nearest-filtered.
