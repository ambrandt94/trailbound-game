# `public/assets`

Derived runtime files only: GLB, PNG, KTX2, and other built assets.

Do not commit Asset Store packages, FBX, Blender, or PSD sources. Those stay outside the repo. `tools/asset-guard.mjs` fails CI on those extensions and on files larger than 10 MB.
