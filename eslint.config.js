import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const layers = ['core', 'platform', 'render', 'audio', 'input', 'ui', 'app'];

/** Local layers a folder may import. Only `app` may reach every layer. */
const allowTypes = {
  core: ['core'],
  platform: ['core', 'platform'],
  render: ['core', 'render'],
  audio: ['core', 'audio'],
  input: ['core', 'input'],
  ui: ['core', 'ui'],
  app: layers,
};

const policies = [];
for (const layer of layers) {
  policies.push({
    from: { element: { type: layer } },
    allow: { to: { element: { types: allowTypes[layer] } } },
  });
  if (layer !== 'core') {
    policies.push({
      from: { element: { type: layer } },
      allow: { to: { module: { origin: 'external' } } },
    });
  }
}

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'public/vendor/**',
      'src/render/area/ct/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': layers.map((type) => ({
        type,
        pattern: `src/${type}`,
        partialMatch: false,
      })),
      'import/resolver': {
        node: {
          extensions: ['.ts', '.tsx', '.js', '.mjs'],
        },
      },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          checkAllOrigins: true,
          policies,
        },
      ],
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  prettier,
);
