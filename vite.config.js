import { cpSync, createReadStream, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The avegeany room editor (avegeany/viewer: plain ES modules + vendored three.js, no
// build step) is published at <base>avegeany/ — served from its source folder by the dev
// server and copied into dist/ on build, so there is exactly one copy of it in the repo.
const EDITOR_DIR = fileURLToPath(new URL('./avegeany/viewer', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
};

function avegeanyEditor() {
  let base = '/', outDir = 'dist';
  return {
    name: 'avegeany-editor',
    configResolved(config) {
      base = config.base;
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url || '').split(/[?#]/)[0]);
        const prefix = `${base}avegeany/`;
        if (!path.startsWith(prefix)) return next();
        const file = resolve(EDITOR_DIR, path.slice(prefix.length) || 'index.html');
        if (!file.startsWith(EDITOR_DIR + sep)) return next();
        try {
          if (!statSync(file).isFile()) return next();
        } catch {
          return next();
        }
        res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },
    writeBundle() {
      cpSync(EDITOR_DIR, resolve(outDir, 'avegeany'), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), avegeanyEditor()],
});
