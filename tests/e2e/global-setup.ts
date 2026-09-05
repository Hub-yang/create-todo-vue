import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DIST_ENTRY = path.resolve(REPO_ROOT, 'dist/index.js')

/**
 * 在任何 E2E worker 启动前构建一次 dist/。
 *
 * 放在 globalSetup 而不是 `pnpm build && vitest run` 的脚本串里，是因为
 * globalSetup 覆盖所有入口：`pnpm test:e2e`、从 IDE 单跑一个文件、以及 --watch。
 * 脚本串只覆盖第一种，剩下两种会静默地对着过期的 dist/ 断言——这是 E2E 里
 * 最难察觉的一类假结果。
 */
export function setup(): void {
  if (process.env.E2E_SKIP_BUILD === '1') {
    if (!fs.existsSync(DIST_ENTRY)) {
      throw new Error(
        `设置了 E2E_SKIP_BUILD=1，但 ${DIST_ENTRY} 不存在。\n`
        + `先跑 \`pnpm build\`，或者去掉 E2E_SKIP_BUILD。`,
      )
    }
    return
  }

  const tsdown = path.resolve(REPO_ROOT, 'node_modules/.bin/tsdown')
  if (!fs.existsSync(tsdown)) {
    throw new Error(`找不到 ${tsdown}，请先跑 \`pnpm install\`。`)
  }

  const { status } = spawnSync(tsdown, [], { cwd: REPO_ROOT, stdio: 'inherit' })
  if (status !== 0) {
    throw new Error(`tsdown 构建失败，退出码 ${status}`)
  }
  if (!fs.existsSync(DIST_ENTRY)) {
    throw new Error(`构建结束但 ${DIST_ENTRY} 仍然不存在`)
  }
}
