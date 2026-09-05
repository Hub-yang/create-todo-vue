import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 只收 .e2e.test.ts 后缀，这样 tests/e2e/helpers 下的文件永远不会被当成用例
    include: ['tests/e2e/**/*.e2e.test.ts'],
    exclude: [...configDefaults.exclude, 'template-*'],
    // 跑任何用例之前先构建 dist/，杜绝对着过期产物断言
    globalSetup: ['tests/e2e/global-setup.ts'],
    // 每个用例都真的 fork 一个 node 进程，5s 的默认值远远不够
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  publicDir: false,
})
