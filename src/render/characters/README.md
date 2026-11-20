# Player avatar hook

`forge.ts` is the game-facing character API. `backends/v1.ts` imports the Character Forge 1.2 runtime. `backends/v2.ts` imports the 2.1.0 runtime. `?cf=0` skips the runtime. `?cf=1` (also `v1` / `cf1`) selects the legacy v1. Any other `?cf=` value, including a missing one, is v2 (the default).

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

`getPlayerBody()` is null until a look is confirmed or a continue warms the saved recipe. After `?cf=0` or a Forge failure it is still a body: `source === 'placeholder'` (a lit capsule pawn, not a block). Do not dispose the body from the area; the creator replaces it on the next confirm. The saved `player.avatar.recipe` is the opaque Forge recipe, so a rebuild of that object matches the creator. Schema 5 records `player.avatar.engine` (`cf2` when a look is confirmed under the default v2 backend, `cf1` under `?cf=1`). A schema 4 save copies that recipe into `legacyRecipe` on load and still builds. Loading a `cf1` avatar while v2 is selected migrates a copy in memory and does not rewrite the save.

Pixies hover. `present` still asks for `Idle` or `Walk`. Forge maps those to Hover / FlyMove and crossfades. `play` is the hard cut the creator uses.

Set the area renderer to `outputColorSpace = SRGBColorSpace` (the shell already does). Forge atlases are sRGB and nearest-filtered.
