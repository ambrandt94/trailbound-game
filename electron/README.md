# `electron`

Desktop shell for milestone G5: a main process, a preload bridge, and a filesystem `SaveBackend` under the user data directory.

G0 does not run Electron. The web build already follows the rules that make G5 a small port: relative asset URLs (`base: './'`), static `content/`, no CDN scripts, and saves behind `SaveBackend` rather than `localStorage`.
