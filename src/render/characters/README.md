# Player avatar hook

`forge.ts` is the game-facing character API. `backends/v2.ts` imports the Character Forge 2.1.1 runtime and is the default. `backends/v1.ts` imports the 1.2.1 runtime and stays in the tree as the fallback. With no `?cf=` param the game loads v2. `?cf=2` (also `v2` / `cf2`) does the same. `?cf=1` (also `v1` / `cf1`) selects v1. `?cf=0` skips the runtime. If v2 fails to init or preload, the game warns and loads v1 so the player still has a body.

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

`getPlayerBody()` is null until a look is confirmed or a continue warms the saved recipe. After `?cf=0` or a Forge failure it is still a body: `source === 'placeholder'` (a lit capsule pawn, not a block). Do not dispose the body from the area; the creator replaces it on the next confirm. The saved `player.avatar.recipe` is the opaque Forge recipe, so a rebuild of that object matches the creator. Schema 5 records `player.avatar.engine`. A look confirmed under the default runtime is `cf2`. A schema 4 save copies that recipe into `legacyRecipe`, tags `engine: 'cf1'`, and still builds. Loading a `cf1` avatar while v2 is selected migrates a copy in memory and does not rewrite the save. Confirming that look stores `engine: 'cf2'` and keeps the old recipe on `legacyRecipe`. Every v2 body, in town and on the road, uses one uniform scale: 1.4 divided by the v2 human height. Races keep their lineup, and the scale is not Y-only. v1 has no catalog height and stays at scale 1.

Pixies hover. `present` still asks for `Idle` or `Walk`. Forge maps those to Hover / FlyMove and crossfades. `play` is the hard cut the creator uses.

Set the area renderer to `outputColorSpace = SRGBColorSpace` (the shell already does). Forge atlases are sRGB and nearest-filtered.
