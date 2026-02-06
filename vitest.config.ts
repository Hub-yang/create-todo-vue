import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/tests/**/*.test.[tj]s'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'template-*',
    ],
    deps: {
      moduleDirectories: ['node_modules'],
    },
    testTimeout: 20000,
    isolate: false,
  },
  publicDir: false,
})
