import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/tests/**/*.test.[tj]s'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'template-*',
      // 必须显式排除：'*.e2e.test.ts' 同样匹配上面 include 里的 '*.test.ts'，
      // 不排掉的话 pre-commit 里的单测会连 E2E 一起跑，每次提交慢好几秒
      'tests/e2e/**',
    ],
    deps: {
      moduleDirectories: ['node_modules'],
    },
    testTimeout: 20000,
    isolate: false,
  },
  publicDir: false,
})
