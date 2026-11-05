# Dependency rule check

`tests/core/dependency-rule.test.ts` is the proof that the architecture rule is actually on.

It lints virtual files with the real ESLint config:

- `src/core` importing `src/platform` must fail.
- `src/core` importing `three` must fail.
- `src/platform` importing `src/render` must fail.
- `src/core` importing another core module must pass.
- `src/app` importing `core` and `platform` must pass.

It also compiles a snippet that mentions `document` with `src/core/tsconfig.json` (`lib: ["ES2022"]`, no DOM) and expects a type error.

Run it with:

```bat
npm test -- tests/core/dependency-rule.test.ts
```
