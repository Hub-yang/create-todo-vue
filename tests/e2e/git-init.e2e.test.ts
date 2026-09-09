import type { Fixture } from './helpers/fixture'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertOk, runCli } from './helpers/cli'
import { createFixture } from './helpers/fixture'

/**
 * CTV-22：生成项目后自动 `git init`。
 *
 * 这些用例会**真的调用 git**（不联网、毫秒级）。前提是运行环境里有 git，CI 与
 * 开发机都满足。
 *
 * `fixture.tree()` 刻意不列 `.git`（见 helpers/fixture.ts 里的注释），所以仓库
 * 是否被创建只能靠 `exists()` 判断——这也是本文件存在的理由：其余 E2E 文件管
 * 文件树与退出码，git 相关的断言全部收在这里，两边不重叠。
 */
const NON_INTERACTIVE = ['--overwrite', '--no-immediate']

/** 断言文案一律硬编码，不从 src/ import——期望值与实际值同源就退化成恒等式 */
const SKIP_MESSAGE = '目标目录已在 git 仓库中，跳过 git init'

describe('生成后初始化 git 仓库', () => {
  let fixture: Fixture
  let failed = false

  beforeEach(() => {
    fixture = createFixture()
    failed = false
  })

  afterEach((ctx) => {
    failed = ctx.task.result?.state === 'fail'
    fixture.cleanup(failed)
  })

  it('生成项目后自动建出 git 仓库', async () => {
    const result = await runCli(fixture, ['my-app', '-t', 'vue-ts', ...NON_INTERACTIVE])
    assertOk(result, fixture)

    expect(fixture.exists('my-app/.git'), '项目目录里应当有 .git').toBe(true)
    // 只判 `.git` 存在还不够：一个空目录也叫 .git。HEAD 是 `git init` 必然产出的
    // 文件，用它区分「真的初始化过」和「碰巧有个同名目录」
    expect(fixture.exists('my-app/.git/HEAD'), '.git 里应当有 HEAD').toBe(true)
  })

  it('不该把 git 的内部文件算进项目文件树', async () => {
    const result = await runCli(fixture, ['my-app', '-t', 'vanilla', ...NON_INTERACTIVE])
    assertOk(result, fixture)

    // 仓库确实建了，但 tree() 里不该出现任何 .git 的痕迹
    expect(fixture.exists('my-app/.git')).toBe(true)
    expect(fixture.tree('my-app').filter(p => p.includes('.git') && !p.includes('.gitignore')))
      .toEqual([])
  })

  it('目标已在 git 仓库内时跳过 init，并说明原因', async () => {
    // 先把 fixture 的工作目录本身变成一个 git 仓库，项目目录就成了它的子目录
    const init = spawnSync('git', ['init'], { cwd: fixture.dir })
    expect(init.status, '测试前置：在 fixture 目录建 git 仓库应当成功').toBe(0)

    const result = await runCli(fixture, ['my-app', '-t', 'vue-ts', ...NON_INTERACTIVE])
    assertOk(result, fixture)

    expect(fixture.exists('my-app/.git'), '不该在已有仓库里造嵌套仓库').toBe(false)
    expect(result.stdout).toContain(SKIP_MESSAGE)
  })

  it('正常情况下不该打印那句跳过提示', async () => {
    const result = await runCli(fixture, ['my-app', '-t', 'vue-ts', ...NON_INTERACTIVE])
    assertOk(result, fixture)

    // 反向钉子：没有这条，把「跳过提示」写成无条件打印也能让上一条用例全绿
    expect(result.stdout).not.toContain(SKIP_MESSAGE)
  })
})
