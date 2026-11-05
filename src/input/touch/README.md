# `src/input/touch`

**Owner: the touch-controls agent** (Alex's separate agent — the same one that owns the controller touch pad).

Other agents wire `attachTouchControls` from `src/app` and do not change the pad. G4 copies the controller pad here as-is, under that agent's review.
