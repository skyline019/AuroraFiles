import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'shared/**/*.test.ts', 'electron/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'src/lib/gridLayout.ts',
        'src/lib/searchRank.ts',
        'src/lib/textDecode.ts',
        'src/lib/batchRename.ts',
        'shared/rbTree.mjs',
        'shared/pathSkip.mjs',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
