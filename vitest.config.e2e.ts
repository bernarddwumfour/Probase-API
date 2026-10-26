import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false, // all files share one database
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});