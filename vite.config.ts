import preact from '@preact/preset-vite';
import { cpSync, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Connect, Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const contentRoot = join(root, 'content');

/**
 * Serves repo-root `content/` in dev and copies it into `dist/content` for
 * preview, static hosting, and Electron. Relative URLs stay valid because
 * Vite `base` is `./`.
 */
function contentPlugin(): Plugin {
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const raw = req.url?.split('?')[0] ?? '';
    if (!raw.startsWith('/content/')) {
      next();
      return;
    }
    let relative = raw.slice('/content/'.length);
    try {
      relative = decodeURIComponent(relative);
    } catch {
      res.statusCode = 400;
      res.end('bad content path');
      return;
    }
    const file = normalize(join(contentRoot, relative));
    if (file !== contentRoot && !file.startsWith(`${contentRoot}${sep}`)) {
      res.statusCode = 403;
      res.end('forbidden');
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end('missing content');
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    createReadStream(file).pipe(res);
  };

  return {
    name: 'trailbound-content',
    configureServer(server) {
      server.middlewares.use(serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve);
    },
    closeBundle() {
      mkdirSync(join(root, 'dist'), { recursive: true });
      cpSync(contentRoot, join(root, 'dist', 'content'), { recursive: true });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [preact(), contentPlugin()],
  server: { host: true, port: 5173, strictPort: true },
  preview: { host: true, port: 4173, strictPort: true },
  build: {
    // Three.js is one chunk in this shell. Later scenes can split it.
    chunkSizeWarningLimit: 700,
  },
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'tests/app/**/*.test.ts',
            'tests/core/**/*.test.ts',
            'tests/platform/**/*.test.ts',
            'tests/tools/**/*.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'render',
          environment: 'happy-dom',
          include: ['tests/render/**/*.test.ts'],
        },
      },
    ],
  },
});
