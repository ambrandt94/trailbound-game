# Player avatar hook

`forge.ts` is the game-facing character API. `backends/v1.ts` is the only file that imports `cf-runtime.mjs` or calls `CF.*`. `?cf=0` skips the runtime. `?cf=2` (also `v2` / `cf2`) is reserved for Character Forge 2 and currently warns, then uses v1. Any other `?cf=` value is v1.

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

`getPlayerBody()` is null until a look is confirmed or a continue warms the saved recipe. After `?cf=0` or a Forge failure it is still a body: `source === 'placeholder'` (a lit capsule pawn, not a block). Do not dispose the body from the area; the creator replaces it on the next confirm. The saved `player.avatar.recipe` is the opaque Forge recipe, so a rebuild of that object matches the creator. Schema 5 records `player.avatar.engine` (`cf1` while this pin is vendored). A schema 4 save copies that recipe into `legacyRecipe` on load and still builds.

Pixies hover. `present` still asks for `Idle` or `Walk`. Forge maps those to Hover / FlyMove and crossfades. `play` is the hard cut the creator uses.

Set the area renderer to `outputColorSpace = SRGBColorSpace` (the shell already does). Forge atlases are sRGB and nearest-filtered.
